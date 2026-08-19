# Runtime data

This directory contains bind-mounted runtime state, not application source.
The backend creates missing subdirectories automatically.

- `pi-agent/`: model credentials, settings, installed extensions and other Pi configuration.
- `user-data/`: managed per-user and per-session workspaces and generated files.

These files must be backed up separately from the application package.
