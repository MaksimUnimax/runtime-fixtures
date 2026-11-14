from .settings import *
INSTALLED_APPS=[*INSTALLED_APPS,'alisa_platform.staff','alisa_platform.entitlements','alisa_platform.alice_link','alisa_platform.queries','alisa_platform.runtime_adapter']
STORES_ENABLED=True
ENTITLEMENTS_ENABLED=True
QUERIES_ENABLED=True
RUNTIME_AUTHORITY_ENABLED=True
RUNTIME_AUTO_BINDINGS_ENABLED=False
OWNER_PARAMETER_COLLECTION_ENABLED=True
RUNTIME_SERVICE_ID='parameter-fixture-platform'
RUNTIME_CATALOG_RELEASE_ID='parameter-fixture-catalog'
RUNTIME_AUTHORITY_TOKEN='synthetic-private-authority-token-0000000000000000000000'
ALICE_LINK_ENABLED=False
ALICE_CLIENT_ID='synthetic-alice-client'
ALICE_CLIENT_SECRET='synthetic-not-for-production-0000000000000'
