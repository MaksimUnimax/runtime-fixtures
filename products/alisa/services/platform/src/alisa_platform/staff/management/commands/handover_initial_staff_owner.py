"""Closed operator step after verifying the target dedicated admin subject."""
from django.core.management.base import BaseCommand,CommandError
from alisa_platform.staff.service import handover_initial_owner
class Command(BaseCommand):
    def add_arguments(self,parser):
        parser.add_argument('--apply',action='store_true',required=True)
        parser.add_argument('--owner-id',required=True)
        parser.add_argument('--expected-subject',required=True)
        parser.add_argument('--expected-revision',type=int,required=True)
        parser.add_argument('--new-subject',required=True)
        parser.add_argument('--name',required=True)
    def handle(self,*args,**o):
        try:member,changed=handover_initial_owner(o['owner_id'],o['expected_subject'],o['expected_revision'],o['new_subject'],o['name'])
        except ValueError as ex:raise CommandError(str(ex)) from None
        self.stdout.write('OWNER_HANDOVER_APPLIED' if changed else 'OWNER_HANDOVER_ALREADY_APPLIED')
