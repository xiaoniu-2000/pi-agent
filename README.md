# 新能源气象智能分析 Agent（前后端分离版）

本项目从 `pi-web-custom` 0.8.1 重构而来，保留了原有界面定制、Pi Agent
能力和 Stage 1 托管会话目录补丁，部署边界改为：

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

删除会话时，会话转录和该会话的 `workspace/` 会一起删除。当前仍使用
`PI_WEB_FIXED_USER_ID` 固定身份；这与原补丁的 Stage 1 范围一致，并不等同于
多用户认证。接入统一登录前，不应把后端开放到不可信网络。

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
PI_WEB_FIXED_USER_ID=user1
PI_WEB_CORS_ORIGINS=http://10.10.10.21:8080
PI_WEB_BACKEND_PORT=30142
```

把 `python_sandbox` 扩展内容复制到 `extensions/python_sandbox/`，或把
`compose.yaml` 中这一条挂载的左侧改为内网服务器上的绝对路径：

```yaml
- /opt/pi/extensions/python_sandbox:/data/pi-agent/extensions/python_sandbox:ro
```

然后启动：

```bash
docker compose up -d --build backend
curl http://127.0.0.1:30142/api/health
```

模型、凭据和 Agent 全局配置放在 `runtime/pi-agent/`；用户会话和生成文件放在
`runtime/user-data/`。两个目录必须对容器内 UID 1000 可写。模型访问内网代理时，
可在 `.env` 设置 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。

### 完全离线服务器

如果内网服务器不能联网，不要在服务器运行 `--build`。在有 npm 和 Docker 的
MacBook 构建 `linux/amd64` 离线包，其中包含后端镜像 tar、配置好后端地址的
`ROOT.war`、Compose 文件和运行目录：

```bash
RELEASE_VERSION=0.1.0 \
  NEXT_PUBLIC_BASE_PATH=/pi-agent \
  PI_WEB_API_BASE_URL=http://10.10.10.21:30142 \
  sh scripts/build-offline-bundle.sh
```

产物为 `dist/pi-agent-install-0.1.0.tar.gz`。把它复制到服务器并解压，
然后只执行：

```bash
cp .env.example .env
# 编辑 .env：PI_WEB_CORS_ORIGINS 必须是 Tomcat 页面地址，例如 http://10.10.10.21:8080
# Linux 上确保容器 UID 1000 可写：chown -R 1000:1000 runtime/pi-agent runtime/user-data
docker load -i pi-agent-backend-0.1.0.tar
docker compose up -d
```

若这套 Docker 没有 Compose 插件，最后一条改成 `sh run-backend.sh`；该脚本只调用
`docker run`。

最后把同一目录中的 `ROOT.war` 复制为
`/opt/agent/tomcat9/webapps/pi-agent.war`。这一流程不会在服务器上
调用 npm 或 Git。若服务器不是 x86_64，可在构建机用
`TARGET_PLATFORM=linux/arm64` 改变镜像架构。

为避免发布包夹带密钥，完整包只创建 `runtime/pi-agent/` 和扩展目录骨架，不复制构建机
上的真实 `auth.json`、`models.json`、`settings.json` 或私有扩展。首次启动前要通过内网
安全渠道把这些运行配置放入服务器对应目录；后续版本更新不会覆盖它们。

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

先编辑 `frontend/public/config.js`：

```js
window.PI_WEB_CONFIG = {
  apiBaseUrl: "http://10.10.10.21:30142"
};
```

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

`config.js` 是运行时配置。Tomcat 解压 WAR 后，可以直接修改对应 Web 应用中的
`config.js` 来切换后端，不必重新生成 WAR。生产环境建议让 Tomcat 或前置网关对
该文件设置 `Cache-Control: no-store`。

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
npm run dev -w backend      # 终端 1
npm run dev -w frontend     # 终端 2
```

浏览器只打开前端：`http://localhost:30141`。`0.0.0.0` 是服务监听地址，不是日常
使用的浏览器地址。后端检查地址是 `http://localhost:30142/api/health`；直接打开
`http://localhost:30142` 也会返回一段 API 服务说明。

本地后端启动脚本会自动设置：

- `runtime/pi-agent/` 为 Pi 配置目录；
- `runtime/user-data/` 为托管用户数据根目录；
- `user1` 为 Stage 1 固定用户；
- `localhost:30141` 为允许访问 API 的开发前端 Origin。

因此界面进入托管会话模式后，不需要也不应该手工输入 `runtime/user-data`。点击
`New`，后端会自动创建
`runtime/user-data/user1/sessions/<session-id>/workspace/`。修改启动脚本或环境变量后，
必须停止并重新启动两个开发进程。

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

默认 `frontend/public/config.js` 已指向 `http://localhost:30142`。也可以临时通过
`?apiUrl=http://host:30142` 覆盖，便于联调。

`npm install` 输出的 deprecated 和 `npm allow-scripts` 信息不是本次
`Failed to fetch` 的原因：安装已经成功且审计结果为 0 个漏洞。不要为了消除提示就
在内网环境盲目批准所有安装脚本；以项目的 typecheck、test、build 是否通过为准。

## 关于 `.gitkeep`

`.gitkeep` 不是程序，也没有任何运行功能；它只是让 Git 能保存空目录的惯用占位
文件，服务器不需要 Git 才能读取这种文件。本项目现在已移除这些占位文件，改用
说明实际用途的 `runtime/**/README.md`。Docker 启动和本地开发脚本也都会创建缺失的
运行目录，所以目录管理逻辑不依赖 Git。

## 安全边界

- 后端没有完整登录系统，当前只适合受信任内网；
- `PI_WEB_CORS_ORIGINS` 应填写精确 Tomcat Origin，避免在共享环境使用 `*`；
- API 只能读取已分配会话工作目录或会话明确引用的文件；
- `python_sandbox` 以只读方式挂载扩展代码，但扩展工具本身拥有的执行能力仍需按
  单位安全要求审查；
- 真正上线多用户前，应由网关完成认证，并把可信用户标识传给后端，再进入 Stage 2
  的动态用户目录映射。

## 相比原项目的主要变化

- 页面与 API/Agent 生命周期彻底分开，前端可独立更新和回滚；
- 静态前端支持 Tomcat 根路径或子路径部署；
- 后端以 standalone Docker 镜像运行，数据、配置、扩展全部外置挂载；
- 新增严格 JSON 的 Apache ECharts 消息渲染；
- 新增对 Agent 生成文件的明显下载入口；
- 保留 `pi-web-v0.8.1-stage1-managed-sessions.patch` 的目录分配、复制、删除和访问控制逻辑。
