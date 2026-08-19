# python_sandbox extension mount point

Place the extension files in this directory before `docker compose up`, or
replace the source side of the corresponding bind mount in `compose.yaml` with
the extension's absolute host path. The backend sees it at:

`/data/pi-agent/extensions/python_sandbox`

Pi discovers this as a global extension while every conversation continues to
work in `/data/users/<user>/sessions/<session>/workspace`.
