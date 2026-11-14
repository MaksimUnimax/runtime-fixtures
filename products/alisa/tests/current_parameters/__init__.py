"""These Django suites run only through their owned PostgreSQL qualifier."""
import os
import unittest

if os.environ.get('DJANGO_SETTINGS_MODULE') not in {
        'current_parameters.settings', 'current_parameters.collection_settings'}:
    raise unittest.SkipTest('Use current_parameters/qualify_collection.py with its owned PostgreSQL settings')
