# Managed user data volume

The Docker backend mounts this directory at `/data/users`. It creates paths in the
form `<user-id>/sessions/<session-id>/workspace` for uploads and generated files.
The container must be able to write to it.
