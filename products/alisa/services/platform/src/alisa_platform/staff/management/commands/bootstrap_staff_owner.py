"""Explicit closed bootstrap, never a public route or migration side effect."""
from django.core.management.base import BaseCommand,CommandError
from alisa_platform.staff.service import bootstrap_owner

class Command(BaseCommand):
    def add_arguments(self,parser):
        parser.add_argument('--apply',action='store_true',required=True)
        parser.add_argument('--subject',required=True,help='Verified pairwise subject for the dedicated admin OIDC client')
        parser.add_argument('--name',required=True)
    def handle(self,*args,**options):
        try:member=bootstrap_owner(options['subject'],options['name'])
        except ValueError as ex:raise CommandError(str(ex)) from None
        self.stdout.write('OWNER_CREATED:'+str(member.pk))
