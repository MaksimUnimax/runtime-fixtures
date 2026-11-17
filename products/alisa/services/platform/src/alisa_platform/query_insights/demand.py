"""Product demand queue over the existing redacted journal; no runtime execution."""
from datetime import timedelta
import hashlib
from uuid import UUID
from django.conf import settings
from django.db import connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from alisa_platform.staff.models import StaffMember
from alisa_platform.staff.policy import PRODUCT
from .models import (Episode, DemandPolicy, DemandCluster, DemandContribution,
                     DemandReceipt, DemandCandidate, DemandDecision)
from .demand_rules import (DEFAULT_POLICY, STATES, DECISIONS, validate_policy,
                           grouping, counted, threshold)
from .wire import canonical


class DemandFailure(Exception):
    def __init__(self, code='DEMAND_VALIDATION_FAILED', status=422):
        self.code, self.status = code, status
        super().__init__(code)


def require(condition, code='DEMAND_VALIDATION_FAILED', status=422):
    if not condition:
        raise DemandFailure(code, status)


def enabled():
    require(getattr(settings, 'QUERY_DEMAND_ENABLED', False) is True,
            'CAPABILITY_UNAVAILABLE', 503)


def identity(value):
    require(type(value) is str)
    try:
        require(str(UUID(value)) == value)
    except ValueError:
        raise DemandFailure() from None
    return value


def lock():
    # Same transaction lock as journal ingestion; never invert Episode/cluster
    # locks against the producer. This is product data serialization, not a runner.
    require(connection.in_atomic_block, 'DEMAND_TRANSACTION_REQUIRED', 503)
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s)', [845073208])


def policy_row():
    row, _ = DemandPolicy.objects.get_or_create(pk=1)
    return row


def active_cluster(cluster):
    seen = set()
    while cluster.merged_into_id:
        require(cluster.pk not in seen, 'DEMAND_LINEAGE_INVALID', 409)
        seen.add(cluster.pk)
        cluster = DemandCluster.objects.get(pk=cluster.merged_into_id)
    return cluster


def decision(cluster, action, facts, actor=None):
    DemandDecision.objects.create(cluster=cluster, actor_id=actor.pk if actor else None,
                                  action=action, facts=facts)


def stats(cluster, policy, now, *, paid=False):
    days = policy['paid_window_days' if paid else 'window_days']
    start = now - timedelta(days=days)
    table = connection.ops.quote_name(DemandContribution._meta.db_table)
    # Aggregate in PostgreSQL, including the tenant/day cap. No client identifiers
    # or unbounded per-client rows are returned to the application or browser.
    sql = f'''WITH daily AS (
        SELECT tenant_pseudonym, (occurred_at AT TIME ZONE 'UTC')::date AS day,
               COUNT(*) AS n
        FROM {table}
        WHERE cluster_id=%s AND eligible AND NOT internal_test
          AND occurred_at >= %s AND occurred_at < %s
          {'AND paid_at_event' if paid else ''}
        GROUP BY tenant_pseudonym, (occurred_at AT TIME ZONE 'UTC')::date
    ) SELECT day, COALESCE(SUM(n),0), COALESCE(SUM(LEAST(n,%s)),0),
             COUNT(DISTINCT tenant_pseudonym)
      FROM daily GROUP BY GROUPING SETS ((day),()) ORDER BY day NULLS FIRST'''
    with connection.cursor() as cursor:
        cursor.execute(sql, [cluster.pk, start, now, policy['tenant_daily_cap']])
        rows = cursor.fetchall()
    total = next(row for row in rows if row[0] is None)
    return {'from': start.isoformat(), 'to': now.isoformat(),
            'raw': int(total[1]), 'contributions': int(total[2]), 'clients': int(total[3]),
            'daily': [{'day': day.isoformat(), 'raw': int(raw),
                       'contributions': int(capped), 'clients': int(clients)}
                      for day, raw, capped, clients in rows if day is not None]}


def totals(value):
    return {key: item for key, item in value.items() if key != 'daily'}


def measurements(cluster, policy, now):
    general, paid = stats(cluster, policy, now), stats(cluster, policy, now, paid=True)
    return general, paid, threshold(policy, general, paid)


def promote(cluster, policy, now, *, actor=None, manual=None, inherited=None):
    general, paid, trigger = measurements(cluster, policy.configuration, now)
    existing = DemandCandidate.objects.filter(cluster=cluster).first()
    urgent = manual in {'CONFIRMED_FINANCIAL_ERROR', 'CONFIRMED_DEFECT'}
    if manual:
        require(cluster.contributions.filter(internal_test=False).exists(),
                'DEMAND_NO_CUSTOMER_EPISODES', 409)
    if existing:
        if inherited and inherited.priority == 'URGENT' and existing.priority != 'URGENT':
            existing.priority = 'URGENT'
            existing.revision += 1
            existing.save(update_fields=['priority', 'state', 'revision', 'updated_at'])
            decision(cluster, 'MERGE_PRIORITY', {'revision': existing.revision}, actor)
        # Retrying creation never reopens or edits an existing decision. Editing
        # a candidate uses its own expected revision below.
        return existing
    if not (trigger or manual or inherited):
        return None
    evidence = {'policy': dict(policy.configuration), 'policy_revision': policy.revision,
                'trigger': 'MANUAL_URGENT' if urgent else 'MANUAL_PROVIDER' if manual else 'MERGED_EXISTING' if inherited else trigger,
                'general': totals(general), 'paid': totals(paid)}
    if manual:
        evidence['reason'] = manual
    candidate = DemandCandidate.objects.create(
        cluster=cluster, policy_revision=policy.revision, evidence=evidence,
        priority='URGENT' if urgent or inherited and inherited.priority == 'URGENT' else 'NORMAL',
        state='WAITING_FOR_PROVIDER' if manual == 'PROVIDER_DEPENDENCY' else
              inherited.state if inherited and inherited.state != 'MERGED' else 'CANDIDATE',
        assignee_id=inherited.assignee_id if inherited else None)
    decision(cluster, 'CANDIDATE_CREATED', {'candidate': str(candidate.pk), 'trigger': evidence['trigger']}, actor)
    return candidate


def capture(episode):
    """Called inside the existing ingest transaction, after durable deduplication."""
    if not getattr(settings, 'QUERY_DEMAND_ENABLED', False):
        return
    lock()
    grouped = grouping(episode.event)
    member = DemandContribution.objects.filter(pk=episode.pk).first()
    if grouped:
        key, profile, example = grouped
        home, _ = DemandCluster.objects.get_or_create(
            fingerprint=key, defaults={'profile': profile, 'example': example})
        require(home.profile == profile, 'DEMAND_GROUP_CHANGED', 409)
        destination = active_cluster(home)
        if member is None:
            member = DemandContribution(episode=episode, cluster=destination, origin=home,
                                        home=home, tenant_pseudonym=episode.tenant_pseudonym,
                                        occurred_at=episode.occurred_at,
                                        paid_at_event=episode.event['access_basis_at_event'] == 'PAYMENT')
        else:
            # A corrected meaning cannot silently remain in an incompatible
            # manual cluster. Compatible manual splits remain deliberate.
            if not member.manual_assignment or member.cluster.profile != profile:
                member.cluster = destination
                member.manual_assignment = False
            member.home = home
        member.source_revision = episode.revision
        member.occurred_at = min(member.occurred_at, episode.occurred_at)
        member.internal_test = member.internal_test or episode.internal_test
        member.eligible = counted(episode.event)
        member.save()
        DemandCluster.objects.filter(pk=member.cluster_id).update(updated_at=timezone.now())
        promote(member.cluster, policy_row(), timezone.now())
    elif member:
        member.eligible = False
        member.internal_test = member.internal_test or episode.internal_test
        member.source_revision = episode.revision
        member.save(update_fields=['eligible', 'internal_test', 'source_revision'])
    DemandReceipt.objects.update_or_create(episode=episode,
        defaults={'source_received_at': episode.received_at})


def candidate_view(candidate):
    assignee = (StaffMember.objects.filter(pk=candidate.assignee_id, product_id=PRODUCT)
                .values_list('name', flat=True).first()) if candidate.assignee_id else None
    return {'id': str(candidate.pk), 'state': candidate.state, 'priority': candidate.priority,
            'assignee_id': str(candidate.assignee_id) if candidate.assignee_id else None,
            'assignee_name': assignee,
            'revision': candidate.revision, 'policy_revision': candidate.policy_revision,
            'evidence': candidate.evidence}


def listing(data, *, actor=None):
    enabled()
    require(type(data) is dict and not set(data) - {'cursor', 'cluster'})
    policy = DemandPolicy.objects.filter(pk=1).first()
    configuration = validate_policy(policy.configuration if policy else DEFAULT_POLICY)
    rows = DemandCluster.objects.filter(merged_into__isnull=True,
        contributions__internal_test=False).distinct().order_by('-updated_at', '-pk')
    if 'cluster' in data:
        rows = rows.filter(pk=identity(data['cluster']))
    if 'cursor' in data:
        anchor = DemandCluster.objects.filter(pk=identity(data['cursor'])).first()
        require(anchor is not None)
        rows = rows.filter(Q(updated_at__lt=anchor.updated_at) |
                           Q(updated_at=anchor.updated_at, pk__lt=anchor.pk))
    selected = list(rows[:21])
    items = []
    now = timezone.now()
    for cluster in selected[:20]:
        general, paid, trigger = measurements(cluster, configuration, now)
        candidate = DemandCandidate.objects.filter(cluster=cluster).first()
        item = {'id': str(cluster.pk), 'revision': cluster.revision, 'example': cluster.example,
                'platform': cluster.profile['platform'], 'date_axis': cluster.profile['date_axis'],
                'general': general if data.get('cluster') else totals(general),
                'paid': paid if data.get('cluster') else totals(paid), 'threshold': trigger,
                'candidate': candidate_view(candidate) if candidate else None}
        if data.get('cluster'):
            members = list(cluster.contributions.select_related('episode').order_by('pk')[:31])
            item['episodes'] = [{'id': str(c.pk), 'source_revision': c.source_revision,
                'origin': str(c.origin_id), 'home': str(c.home_id),
                'internal_test': c.internal_test, 'eligible': c.eligible,
                'example': grouping(c.episode.event)[2] if grouping(c.episode.event) else None,
                'at': c.occurred_at.isoformat()}
                for c in members[:30]]
            item['episodes_more'] = len(members) > 30
            item['decisions'] = [{'action': d.action, 'actor_id': str(d.actor_id) if d.actor_id else None,
                'actor_name': StaffMember.objects.filter(pk=d.actor_id, product_id=PRODUCT)
                    .values_list('name', flat=True).first() if d.actor_id else None,
                'facts': d.facts, 'at': d.created_at.isoformat()}
                for d in cluster.decisions.order_by('-created_at', '-pk')[:20]]
        items.append(item)
    pending = Episode.objects.filter(Q(demandreceipt__isnull=True) |
        Q(demandreceipt__source_received_at__lt=F('received_at'))).exists()
    can_manage = actor is not None and actor.role == 'OWNER'
    return {'policy': configuration, 'policy_revision': policy.revision if policy else 0,
            'items': items, 'next_cursor': str(selected[19].pk) if len(selected) > 20 else None,
            'pending_events': pending, 'can_manage': can_manage,
            'assignees': list(StaffMember.objects.filter(product_id=PRODUCT, active=True)
                .order_by('name', 'pk').values('id', 'name')[:100]) if can_manage else []}


def checked_cluster(cluster_id, revision):
    require(type(cluster_id) is str and type(revision) is int and revision >= 1)
    cluster = DemandCluster.objects.filter(pk=identity(cluster_id)).first()
    require(cluster is not None and cluster.merged_into_id is None,
            'DEMAND_CLUSTER_CHANGED', 409)
    require(cluster.revision == revision, 'DEMAND_REVISION_CONFLICT', 409)
    return cluster


def command(action, data, actor):
    enabled()
    require(type(data) is dict)
    lock()
    policy = policy_row()
    now = timezone.now()
    if action == 'refresh':
        require(not set(data) - {'cursor'})
        pending = Episode.objects.filter(Q(demandreceipt__isnull=True) |
            Q(demandreceipt__source_received_at__lt=F('received_at'))).order_by('received_at', 'pk')
        for episode in list(pending[:200]):
            capture(episode)
        page = listing(data, actor=actor)
        for item in page['items']:
            promote(DemandCluster.objects.get(pk=item['id']), policy, now)
        return listing(data, actor=actor)
    if action == 'policy':
        require(set(data) == {'expected_revision', 'policy'})
        require(type(data['expected_revision']) is int and data['expected_revision'] in
                ({0, 1} if policy.revision == 1 else {policy.revision}), 'DEMAND_REVISION_CONFLICT', 409)
        policy.configuration = validate_policy(data['policy'])
        policy.revision += 1
        policy.save()
        decision(None, 'POLICY_UPDATED', {'revision': policy.revision,
                 'policy': dict(policy.configuration)}, actor)
        return {'policy': policy.configuration, 'policy_revision': policy.revision}
    if action == 'merge':
        require(set(data) == {'source', 'source_revision', 'target', 'target_revision'})
        source = checked_cluster(data['source'], data['source_revision'])
        target = checked_cluster(data['target'], data['target_revision'])
        require(source.pk != target.pk and source.profile == target.profile,
                'DEMAND_INCOMPATIBLE_MEANING', 409)
        source_candidate = DemandCandidate.objects.filter(cluster=source).first()
        target_candidate = DemandCandidate.objects.filter(cluster=target).first()
        def workflow(candidate):
            return candidate_view(candidate) if candidate else None
        before_workflows = {'source_candidate': workflow(source_candidate),
                            'target_candidate': workflow(target_candidate)}
        DemandContribution.objects.filter(cluster=source).update(cluster=target)
        source.merged_into = target
        source.revision += 1
        source.save()
        target.revision += 1
        target.save()
        promote(target, policy, now, actor=actor, inherited=source_candidate)
        if source_candidate:
            source_candidate.state = 'MERGED'
            source_candidate.revision += 1
            source_candidate.save()
        facts = {'source': str(source.pk), 'target': str(target.pk), **before_workflows}
        decision(source, 'MERGED', facts, actor)
        decision(target, 'MERGED_FROM', facts, actor)
        return {'cluster': str(target.pk), 'revision': target.revision}
    require(set(data) >= {'cluster', 'expected_revision'})
    cluster = checked_cluster(data['cluster'], data['expected_revision'])
    if action == 'split':
        require(set(data) == {'cluster', 'expected_revision', 'episodes'})
        identities = data['episodes']
        require(type(identities) is list and 1 <= len(identities) <= 30 and
                all(type(i) is str for i in identities) and len(set(identities)) == len(identities))
        for item in identities:
            identity(item)
        members = list(DemandContribution.objects.filter(cluster=cluster, pk__in=identities).select_related('episode'))
        require(len(members) == len(identities), 'DEMAND_CLUSTER_CHANGED', 409)
        grouped = [grouping(m.episode.event) for m in members]
        require(all(g is not None for g in grouped))
        require(all(g[1] == grouped[0][1] for g in grouped), 'DEMAND_INCOMPATIBLE_MEANING', 409)
        fingerprint = hashlib.sha256(canonical({'split': str(cluster.pk),
            'revision': cluster.revision, 'episodes': sorted(identities)}).encode()).hexdigest()
        child = DemandCluster.objects.create(fingerprint=fingerprint, profile=grouped[0][1], example=grouped[0][2])
        DemandContribution.objects.filter(pk__in=identities).update(cluster=child, manual_assignment=True)
        cluster.revision += 1
        cluster.save()
        promote(child, policy, now, actor=actor)
        facts = {'source': str(cluster.pk), 'target': str(child.pk), 'count': len(members)}
        decision(cluster, 'SPLIT', facts, actor)
        decision(child, 'SPLIT_FROM', facts, actor)
        return {'cluster': str(child.pk), 'revision': child.revision}
    if action == 'create':
        require(set(data) == {'cluster', 'expected_revision', 'reason'})
        require(type(data['reason']) is str and data['reason'] in
                {'CONFIRMED_FINANCIAL_ERROR', 'CONFIRMED_DEFECT', 'PROVIDER_DEPENDENCY'})
        candidate = promote(cluster, policy, now, actor=actor, manual=data['reason'])
        return candidate_view(candidate)
    require(action == 'update' and set(data) == {'cluster', 'expected_revision',
            'candidate_revision', 'state', 'priority', 'assignee_id', 'reason'})
    candidate = DemandCandidate.objects.filter(cluster=cluster).first()
    require(candidate is not None and type(data['candidate_revision']) is int and
            candidate.revision == data['candidate_revision'], 'DEMAND_REVISION_CONFLICT', 409)
    require(type(data['state']) is str and data['state'] in STATES and
            type(data['reason']) is str and data['reason'] in DECISIONS)
    require(type(data['priority']) is str and data['priority'] in {'NORMAL', 'URGENT'})
    assignee = data['assignee_id']
    require(assignee is None or type(assignee) is str)
    if assignee is not None:
        identity(assignee)
        require(StaffMember.objects.filter(pk=assignee, product_id=PRODUCT, active=True).exists())
    candidate.state, candidate.assignee_id = data['state'], assignee
    candidate.priority = data['priority']
    candidate.revision += 1
    candidate.save()
    decision(cluster, 'UPDATED', {'state': candidate.state, 'priority': candidate.priority, 'assignee_id': assignee,
        'reason': data['reason'], 'revision': candidate.revision}, actor)
    return candidate_view(candidate)
