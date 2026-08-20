# 新能源气象智能分析 Agent（前后端分离版）

本项目从 `pi-web-custom` 0.8.1 重构而来，保留了原有界面定制、Pi Agent
能力、托管会话目录和 Stage 2 多用户登录，部署边界改为：

- `frontend/`：纯静态 Next.js 导出物，可打包为 WAR 放入 Tomcat；
- `backend/`：仅提供 API、SSE、AgentSession 和文件服务，以 Docker 运行；
- `runtime/user-data/`：一用户 / 一会话 / 一工作目录的数据卷；
- `extensions/python_sandbox/`：运行后端容器时挂载的扩展目录。

浏览器不再依赖 Next.js 页面服务器。前端的 `public/config.js` 在运行时决定
后端地址，所以换服务器 IP 时不必重新编译前端。

为消除原锁文件中的生产安全公告，本分离版已同步到 Next.js 16.3.1、Pi
0.84.2、Undici 8.10.0 和 Apache ECharts 6.1.0；完整类型检查、测试、静态
导出、WAR 打包、Docker 构建与生产依赖审计均已通过。

## 目录结构

```text
pi-web-separated/
├── frontend/                 # 静态 Web 前端、ECharts、Tomcat WAR 脚本
├── backend/                  # API-only Next.js、Pi Agent、Dockerfile
├── extensions/
│   └── python_sandbox/       # python_sandbox 扩展挂载点
├── runtime/
│   ├── pi-agent/             # models.json、auth.json、settings.json 等
│   └── user-data/            # 托管会话和用户生成文件
├── compose.yaml
└── .env.example
```

托管会话目录保持 Stage 1 设计：

```text
runtime/user-data/
└── <user-id>/
    └── sessions/
        └── <session-id>/
            ├── meta.json
            ├── <session>.jsonl
            └── workspace/        # 上传文件、脚本、图表数据、生成报告
```

删除会话时，会话转录和该会话的 `workspace/` 会一起删除。启用
`PI_WEB_AUTH_ENABLED=1` 后，后端从签名的 HttpOnly 登录 Cookie 中取得当前用户，
所有会话、文件允许根目录、运行中 Agent 和缓存均按用户隔离。`PI_WEB_FIXED_USER_ID`
只在显式设置 `PI_WEB_AUTH_ENABLED=0` 时作为单用户开发兼容身份。
登录页支持自助注册；网页注册的账号始终是普通用户，管理员只能通过服务器上的账号
管理脚本创建或提升。可用 `PI_WEB_SELF_REGISTRATION_ENABLED=0` 随时关闭新注册。

`meta.json` 的 `createdAt` 使用带明确 `+08:00` 偏移的北京时间。浏览器为新对话
预分配的目录若在页面关闭、切回历史会话或被另一个新草稿替代时，仍无会话转录、
无工作区文件且没有活动 Agent，就会被安全清理；包含任何用户文件或对话内容的目录
不会由这条草稿清理逻辑删除。

托管服务器模式不请求 Git worktree 状态，也不显示仅适用于 Git 仓库的 worktree
选择行；普通目录选择、历史会话恢复和文件浏览不受影响。

## 1. 启动 Docker 后端

服务器只要求 Docker，推荐使用 Docker Compose 插件，但离线包也附带纯
`docker run` 启动脚本；不要求安装 Node.js、npm 或 Git。`backend/Dockerfile`
的构建阶段在容器内执行 npm；运行阶段只用容器内的
Node.js 启动 API。镜像内部保留 Git/Python，是 Pi Agent 工具可能使用的运行依赖，
与服务器宿主机是否安装 Git 无关。

如果服务器可以访问 Docker 镜像源，可以直接在服务器从源码构建：

```bash
cp .env.example .env
```

编辑 `.env`：

```dotenv
PI_WEB_AUTH_ENABLED=1
PI_WEB_SELF_REGISTRATION_ENABLED=1
PI_WEB_MAX_USERS=500
PI_WEB_SESSION_TTL_HOURS=12
PI_WEB_COOKIE_SECURE=0
PI_WEB_CORS_ORIGINS=http://10.10.10.21:18093
PI_WEB_BACKEND_PORT=30142
```

`PI_WEB_CORS_ORIGINS` 填写 Origin，不带 `/pi-agent` 路径。当前若仍使用 HTTP，
`PI_WEB_COOKIE_SECURE` 必须为 `0`；前置网关启用 HTTPS 后改为 `1`。

把 `python_sandbox` 扩展内容复制到 `extensions/python_sandbox/`，或把
`compose.yaml` 中这一条挂载的左侧改为内网服务器上的绝对路径：

```yaml
- /opt/pi/extensions/python_sandbox:/data/pi-agent/extensions/python_sandbox:ro
```

先构建镜像并创建第一个管理员。使用 `user1` 可直接保留现有
`runtime/user-data/user1/` 中的历史会话：

```bash
docker compose build backend
docker compose run --rm backend node scripts/manage-web-user.mjs set user1 --admin
docker compose up -d backend
curl http://127.0.0.1:30142/api/health
```

账号脚本会在终端中隐藏密码输入，并把 scrypt 密码哈希写入
`runtime/pi-agent/web-users.json`；不会保存明文密码。修改密码会使该账号已有登录
Cookie 立即失效。`user1` 会继续保持管理员身份；同事可以直接在登录页注册普通账号，
也可以由管理员预先新增或查看账号：

```bash
docker compose run --rm backend node scripts/manage-web-user.mjs set user2
docker compose run --rm backend node scripts/manage-web-user.mjs list
```

模型、凭据和 Agent 全局配置放在 `runtime/pi-agent/`；用户会话和生成文件放在
`runtime/user-data/`。两个目录必须对容器内 UID 1000 可写。模型访问内网代理时，
可在 `.env` 设置 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。

### 完全离线服务器

如果内网服务器不能联网，不要在服务器运行 `--build`。在有 npm 和 Docker 的
MacBook 构建 `linux/amd64` 离线包，其中包含后端镜像 tar、自动使用页面主机名的
`ROOT.war`、Compose 文件和运行目录：

```bash
RELEASE_VERSION=0.1.0 \
  NEXT_PUBLIC_BASE_PATH=/pi-agent \
  sh scripts/build-offline-bundle.sh
```

默认页面会自动连接“当前页面主机名”的 `30142` 端口，因此本机使用
`127.0.0.1` 或 `localhost`、服务器使用 `10.10.10.21` 时都不必改源码。只有后端
确实位于另一台主机时，才需要额外传入 `PI_WEB_API_BASE_URL`。

产物为 `dist/pi-agent-install-0.1.0.tar.gz`。把它复制到服务器并解压，
然后只执行：

```bash
cp .env.example .env
# 编辑 .env：PI_WEB_CORS_ORIGINS 必须是 Tomcat 页面地址，例如 http://10.10.10.21:18093
# Linux 上确保容器 UID 1000 可写：chown -R 1000:1000 runtime/pi-agent runtime/user-data
docker load -i pi-agent-backend-0.1.0.tar
docker compose run --rm backend node scripts/manage-web-user.mjs set user1 --admin
docker compose up -d
```

若这套 Docker 没有 Compose 插件，最后一条改成 `sh run-backend.sh`；该脚本只调用
`docker run`。创建账号的命令相应改为：

```bash
sh run-backend.sh manage-user set user1 --admin
```

最后把同一目录中的 `ROOT.war` 复制为
`/opt/agent/tomcat9/webapps/pi-agent.war`。这一流程不会在服务器上
调用 npm 或 Git。若服务器不是 x86_64，可在构建机用
`TARGET_PLATFORM=linux/arm64` 改变镜像架构。

为避免发布包夹带密钥，完整包只创建 `runtime/pi-agent/` 和扩展目录骨架，不复制构建机
上的真实 `auth.json`、`models.json`、`settings.json`、`web-users.json`、登录签名密钥或
私有扩展。首次启动前要通过内网安全渠道把模型运行配置放入服务器对应目录，并在服务器
执行上面的账号创建命令；后续版本更新不会覆盖它们。

这个完整 `.tar.gz` 只用于首次安装或前后端同时发布。里面的 `run-backend.sh` 是没有
Docker Compose 插件时的 `docker run` 备用入口；`DEPLOY.txt` 只是给运维人员看的操作
说明。这两个文件都不是应用运行依赖，服务器已有 Compose 时可以不使用
`run-backend.sh`，也可以在部署完成后不保留 `DEPLOY.txt`。

### 日常只更新后端

前端页面、后端接口契约没有变化时，可以像 `langchainN.tar` 一样每个版本只发布一个
后端镜像 tar。在 x86_64 构建机执行：

```bash
RELEASE_VERSION=0.1.1 npm run build:backend-release
```

产物只有 `dist/pi-agent-backend-0.1.1.tar`。把它复制到服务器现有部署目录，执行：

```bash
docker load -i pi-agent-backend-0.1.1.tar
# 编辑 .env：PI_WEB_BACKEND_IMAGE=pi-web-separated-backend:0.1.1
docker compose up -d --force-recreate backend
curl http://127.0.0.1:30142/api/health
```

这一更新不会覆盖 `.env`、`runtime/pi-agent/`、`runtime/user-data/` 或扩展目录，也不需要
替换 Tomcat WAR。回滚时把 `.env` 的 `PI_WEB_BACKEND_IMAGE` 改回旧标签，再执行同一条
Compose 命令。若某一版修改了页面或后端接口不再兼容旧页面，则该版仍需同时替换 WAR。

## 2. 构建 Tomcat 前端

构建机要求 Node.js 22.19+。前端依赖在构建时打包，ECharts 不使用公网 CDN，
部署到隔离内网后仍可正常绘图。

安装依赖并生成根应用 WAR：

```bash
npm install
npm run build:war -w frontend
```

产物为 `frontend/dist/ROOT.war`。复制到 Tomcat 的 `webapps/`，替换旧的
`ROOT.war` / `ROOT/` 后启动 Tomcat即可。

如果必须部署到 `/pi-agent` 上下文，而不是 Tomcat 根路径：

```bash
NEXT_PUBLIC_BASE_PATH=/pi-agent WAR_NAME=pi-agent npm run build:war -w frontend
```

产物为 `frontend/dist/pi-agent.war`，访问地址为
`http://<tomcat-host>:<port>/pi-agent/`。

`config.js` 是运行时配置，默认自动使用页面当前主机名和后端端口 `30142`，登录页不会
要求用户填写后端地址。Tomcat 解压 WAR 后，仍可修改对应 Web 应用中的 `config.js`
切换到另一台后端，不必重新生成 WAR。生产环境建议让 Tomcat 或前置网关对该文件设置
`Cache-Control: no-store`。

## 3. ECharts 交互图

当前 Pi Agent 已能实现与示例中同类的 ECharts 交互曲线。后端会把富输出协议附加到
Agent 系统提示中；时间序列、对比和分布类任务会优先建议同时给出交互图。Agent 返回
下面这种严格 JSON 代码块时，浏览器端会把它渲染为自适应、可缩放、带 tooltip 的
交互图表：

````markdown
```echarts
{
  "title": { "text": "风速时序" },
  "tooltip": { "trigger": "axis" },
  "xAxis": { "type": "category", "data": ["00:00", "00:30", "01:00"] },
  "yAxis": { "type": "value", "name": "m/s" },
  "series": [{ "type": "line", "smooth": true, "data": [7.6, 8.2, 8.8] }]
}
```
````

解析器只接受 JSON 数据，不执行 Agent 返回的 JavaScript 函数，并限制配置深度和
节点数量。可通过 `PI_WEB_RICH_OUTPUT=0` 停止向 Agent 注入这段格式说明。

## 4. 图片自动展示与文件下载

图片和报告不再只依赖 Agent 是否记得写 Markdown。本轮 Agent 开始前，后端会记录当前
托管会话 `workspace/` 中可发布文件的元数据；本轮结束后再次扫描并记录新建或修改的
结果。此前用于联调的“自动发布产物”重复卡片在正式界面中不再渲染，Agent 的富输出
规则、正文中的图片预览和文件下载控件不受影响：

- PNG、JPEG、WebP、GIF、SVG 等图片直接嵌入聊天，同时提供下载；
- DOCX、PDF、XLSX、CSV、NetCDF、压缩包等生成下载项；
- 不读取文件内容，不发布 Python/JavaScript/TypeScript 等源码；
- 只处理当前托管会话的精确 `workspace/`，忽略隐藏目录和符号链接；
- 单轮扫描和展示都有数量上限，防止异常目录拖慢服务。

因此 Agent 无需查看 `frontend/` 或 `backend/` 源码来猜测链接规则。可通过
`PI_WEB_AUTO_PUBLISH=0` 关闭自动发布。

原有 `/api/files/...?...type=download` 流式接口继续使用，并保留路径白名单、
会话引用校验、符号链接边界和 `Content-Disposition: attachment`。新增前端交互会把
Agent 回复中的本地文件 Markdown 链接显示为“预览 + 下载”：

```markdown
[下载质控报告](file:///data/users/user1/sessions/<id>/workspace/report.docx)
```

文件树和右侧文件预览页也都提供下载按钮；跨域下载 URL 会自动使用 `config.js`
中配置的后端地址。Agent 的系统提示明确说明自动发布机制，并禁止通过读取应用源码
或自行拼接 API URL 来寻找展示办法。

## 5. 权限与隔离边界

直接运行 `npm run dev -w backend` 时，Agent 进程继承当前 macOS 用户的文件权限。
这适合本机开发调试，但它不是安全沙箱；只靠系统提示无法阻止一个工具型 Agent 读取
同一用户可访问的其他目录。

生产方式的隔离边界是 Docker：

- 后端容器根文件系统只读，并启用 `no-new-privileges`、移除 Linux capabilities；
- 只有 `/data/pi-agent`、`/data/users` 和临时 `/tmp` 可按配置写入；
- Tomcat 中的纯静态前端既不在后端镜像里，也不挂载进后端容器；
- `python_sandbox` 扩展以只读方式挂载。

这样部署后，Agent 无法修改 Tomcat 前端代码。需要验证不可信任务时，也应在 MacBook
上构建并运行 Docker 后端，而不是用直接 `npm run dev` 作为隔离环境。

## 6. 后续接入 RAG

当前 Pi Agent 支持扩展注册自定义工具，因此不需要改 Agent 核心就能接入 RAG。推荐
新增一个只负责 `knowledge_search` 的 Pi 扩展：Agent 在需要单位知识时调用该工具，
扩展向内网 RAG 检索 API 传入问题和过滤条件，再把 Top-K 文本片段、来源和相关度返回
给 Agent。文档解析、切分、向量化、写入 Milvus 仍由独立的知识入库流程完成。

使用内网 HTTP 检索接口时，扩展可以放在
`runtime/pi-agent/extensions/knowledge_search.ts`，并读取 `.env` 预留的 `RAG_API_URL`
和 `RAG_API_KEY`。该目录是外置卷，因此扩展本身也可以独立更新；使用 Node 内置
`fetch` 调用检索服务时通常不需要重建后端镜像。

如果现有 `agent-api` 已经封装了 LangChain、Embedding 和 Milvus，优先复用它的 HTTP
检索接口，而不是让 Pi 后端直接操作 Milvus。这样 Milvus collection schema、向量维度、
混合检索和 rerank 都留在 RAG 服务内，Pi 侧只新增一个扩展和 `RAG_API_URL` 等少量配置，
以后更换向量库也不会影响聊天后端。只有现有服务没有检索 API 时，才考虑在扩展中
直接使用 Milvus Node SDK。

仅在 `.env` 中声明 `MILVUS_HOST` 等变量不会自动获得 RAG 能力。实施前至少要确认：

- 文档的入库、更新和删除流程；
- Embedding 服务地址、模型和向量维度，且查询与入库必须使用同一套模型；
- collection 字段、Top-K、过滤条件、是否 rerank；
- 返回片段携带文件名、页码或 URL，以便回答展示来源；
- 多用户上线时，检索层按用户、部门或知识库权限过滤。

## 本地开发与检查

```bash
npm install
npm run user:set -- user1 --admin
npm run dev -w backend      # 终端 1
npm run dev -w frontend     # 终端 2
```

浏览器只打开前端：`http://localhost:30141`。`0.0.0.0` 是服务监听地址，不是日常
使用的浏览器地址。后端检查地址是 `http://localhost:30142/api/health`；直接打开
`http://localhost:30142` 也会返回一段 API 服务说明。

本地后端启动脚本会自动设置：

- `runtime/pi-agent/` 为 Pi 配置目录；
- `runtime/user-data/` 为托管用户数据根目录；
- Web 登录默认开启，账号从 `runtime/pi-agent/web-users.json` 读取；
- 自助注册默认开启，网页新账号固定为普通用户，`user1` 管理员不会被覆盖；
- `localhost:30141` 为允许访问 API 的开发前端 Origin。

因此界面进入托管会话模式后，不需要也不应该手工输入 `runtime/user-data`。用户登录后
点击 `New`，后端会自动创建
`runtime/user-data/<登录用户>/sessions/<session-id>/workspace/`。修改启动脚本或环境
变量后，必须停止并重新启动两个开发进程。

需要让局域网其他电脑联调时，使用下面的命令，并把实际前端 IP Origin 明确加入
CORS；不要让浏览器访问 `0.0.0.0`：

```bash
PI_WEB_CORS_ORIGINS=http://192.168.1.20:30141 npm run dev:lan -w backend
npm run dev:lan -w frontend
```

其余检查命令：

```bash

npm run typecheck
npm test
npm run build
```

默认 `frontend/public/config.js` 会使用浏览器当前主机名和 `30142` 端口，避免
`localhost` 与 `127.0.0.1` 混用导致登录 Cookie 丢失。也可以临时通过
`?apiUrl=http://host:30142` 覆盖，便于跨主机联调。

`npm install` 输出的 deprecated 和 `npm allow-scripts` 信息不是本次
`Failed to fetch` 的原因：安装已经成功且审计结果为 0 个漏洞。不要为了消除提示就
在内网环境盲目批准所有安装脚本；以项目的 typecheck、test、build 是否通过为准。

## 关于 `.gitkeep`

`.gitkeep` 不是程序，也没有任何运行功能；它只是让 Git 能保存空目录的惯用占位
文件，服务器不需要 Git 才能读取这种文件。本项目现在已移除这些占位文件，改用
说明实际用途的 `runtime/**/README.md`。Docker 启动和本地开发脚本也都会创建缺失的
运行目录，所以目录管理逻辑不依赖 Git。

## 安全边界

- 后端要求账号密码登录，密码使用 scrypt 哈希，登录态使用签名 HttpOnly Cookie；
- 自助注册账号固定为普通用户，并有注册频率和账号总数限制；人员入组结束后可设置
  `PI_WEB_SELF_REGISTRATION_ENABLED=0` 关闭公开注册；
- `PI_WEB_CORS_ORIGINS` 应填写精确 Tomcat Origin，避免在共享环境使用 `*`；
- API 只能读取已分配会话工作目录或会话明确引用的文件；
- 后端端口仍建议只允许本机或前置网关访问，并尽快通过 HTTPS 设置
  `PI_WEB_COOKIE_SECURE=1`；
- `python_sandbox` 以只读方式挂载扩展代码，但扩展工具本身拥有的执行能力仍需按
  单位安全要求审查；
- `runtime/pi-agent/models.json`、模型供应商凭据、全局 Skills/Plugins 仍是共享配置，
  应只交由可信管理员维护；用户聊天和工作文件则按登录账号隔离。

## 相比原项目的主要变化

- 页面与 API/Agent 生命周期彻底分开，前端可独立更新和回滚；
- 静态前端支持 Tomcat 根路径或子路径部署；
- 后端以 standalone Docker 镜像运行，数据、配置、扩展全部外置挂载；
- 新增严格 JSON 的 Apache ECharts 消息渲染；
- 新增对 Agent 生成文件的明显下载入口；
- 将 Stage 1 固定 `user1` 升级为带登录态的请求级用户目录隔离，同时兼容原 `user1` 数据。
- 新增自助注册、当前用户/角色展示和明确的退出入口；`user1` 保持管理员身份。
