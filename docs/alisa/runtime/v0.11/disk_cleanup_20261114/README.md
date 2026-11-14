# Disk review and regenerable cache cleanup

Remove downloaded package indexes and old npm content cache while preserving the running npx installation. Remove only standard Python bytecode caches inside real release virtual environments, with a corresponding unchanged Python source. All release directories, package metadata, application sources, databases, credentials, user settings and test evidence remain in place.

The bytecode cleanup is independently reviewed at its exact hash. It verifies source and manifest hashes before/after, repeats file and symlink checks before unlink, and compares active service state afterward. No deployment, service restart, new cleanup scheduler, application reservation change or filesystem reservation change is made.

Actual filesystem measurements and acceptance outcomes are private owner reports, outside this code tree.
