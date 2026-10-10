# custom — các tuỳ biến riêng của fork HoangIT-69/airi

Thư mục này chứa phần custom nằm ngoài code lõi, để kéo bản mới từ upstream không bị conflict.

## Card "Thư Ký" (Mai)

Persona thư ký kiêm trợ lý code bằng tiếng Việt. Mặc định dùng VRM `AvatarSample_A` (`preset-vrm-1`). Provider/model để trống, nên card dùng cấu hình chung trong Settings.

Nguồn: `cards/thu-ky/card.json` (Character Card v3) và `cards/thu-ky/manifest.json`.

Đóng gói (PowerShell, chạy trong thư mục `custom/`):

```powershell
Compress-Archive -Path cards/thu-ky/manifest.json,cards/thu-ky/card.json -DestinationPath dist/thu-ky.airi-card.zip -Force
```

Import: Settings → Character card (AIRI Card) → Import → chọn `dist/thu-ky.airi-card.zip` → kích hoạt card.

## Claude Code → Mai (`claude-code-hook/notify-airi.mjs`)

Hook của Claude Code. Mai báo khi Claude Code làm xong một lượt dài (`Stop`, mặc định ≥ 60 giây) hoặc cần bạn duyệt (`Notification`).

- Gửi `input:text` tới channel server của AIRI (`ws://localhost:6121/ws`). Token đọc từ `%APPDATA%/@proj-airi/stage-tamagotchi/server-channel-config.json`.
- Luôn thoát mã 0. Khi AIRI đang tắt, hook không làm gì.
- Cần `pnpm install` trong repo này, vì hook dùng `packages/server-sdk/dist`.
- Biến môi trường tùy chọn: `AIRI_NOTIFY_MIN_SECONDS`, `AIRI_CHANNEL_URL`, `AIRI_CHANNEL_TOKEN`, `AIRI_NOTIFY_DEBUG=1`.

Đăng ký trong `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"D:/AIWorkStation/projects/airi/custom/claude-code-hook/notify-airi.mjs\"", "timeout": 10 }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"D:/AIWorkStation/projects/airi/custom/claude-code-hook/notify-airi.mjs\"", "timeout": 10 }] }]
  }
}
```

## MCP chỉ đọc (`mcp-workspace-reader/server.mjs`)

MCP server stdio, không có dependency. Tool: `list_projects`, `list_dir`, `read_file`, `find_files`, `git_status`, `git_log`, `git_diff`.

- **Không có tool ghi.** AIRI chạy tool MCP mà không hỏi lại, nên server này phải giữ chỉ đọc.
- Chặn `.env*` (trừ `.env.example`), `*.local.md`, `account-info.md`, `.claude/local`, `settings.local.json`, khóa (`*.pem`, `*.key`), `.git`, `node_modules`, `.next`, `.open-next`. Chặn cả đường dẫn thoát khỏi `WORKSPACE_ROOT`.
- Giới hạn: file 200 KB, output 50 000 ký tự.
- Luật chặn dùng chung ở `shared/path-guard.mjs`. Logic MCP dùng chung (`handleMcpMessage`, vòng lặp stdio) ở `shared/mcp-stdio.mjs`. Định nghĩa tool nằm trong `tools.mjs` của từng server.

Đăng ký trong `%APPDATA%/@proj-airi/stage-tamagotchi/mcp.json`, hoặc Settings → Modules → MCP:

```json
{
  "mcpServers": {
    "workspace-reader": {
      "command": "node",
      "args": ["D:/AIWorkStation/projects/airi/custom/mcp-workspace-reader/server.mjs"],
      "env": { "WORKSPACE_ROOT": "D:/AIWorkStation/projects" },
      "enabled": true
    }
  }
}
```

## Kho tri thức + Wiki (`knowledge/`)

MCP server stdio, chạy ngay trong AIRI, không cần Docker. Thiết kế và prompt port từ [Tencent/WeKnora](https://github.com/Tencent/WeKnora) v0.8.2 (MIT). Ghi chú nguồn `file:line` nằm trong từng module.

| Module | Việc |
|---|---|
| `extract.mjs` | PDF (`unpdf`), DOCX (bảng → Markdown), PPTX, XLSX, HTML, MD, ảnh. Lấy ảnh nhúng cho vision |
| `chunk.mjs` | 512 ký tự, overlap 80. Không cắt bảng, code fence, link. Lặp lại tiêu đề bảng khi bảng bị tách. Breadcrumb heading. Mã nguồn chia theo khối, header `path:dòng` |
| `db.mjs` | `node:sqlite` + FTS5 (`remove_diacritics 2`: gõ không dấu vẫn tìm ra) |
| `embed.mjs` | Voyage, `input_type` document/query. `voyage-3.5` cho tài liệu, `voyage-code-3` cho code |
| `search.mjs` | Hybrid: vector + BM25, RRF trọng số 0.7/0.3, MMR λ=0.7 |
| `llm.mjs`, `vision.mjs`, `profile.mjs` | Claude qua `@anthropic-ai/sdk`. OCR + caption ảnh, hồ sơ tài liệu (summary, gist, topics, loại) |
| `ingest.mjs` | Quét folder (chặn file bí mật), diff SHA-256, job nền. Code lấy từ `git ls-files` |
| `wiki*.mjs` | Map (Haiku: thực thể/khái niệm + trang tóm tắt) → dedup → reduce (Sonnet: gộp trang kiểu "compiler") → index + linkify + dọn link chết. Folder có code thì thêm trang `overview/architecture` |

Tool:
- **Folder:** `add_folder(path, includeCode)`, `sync_folders`, `list_folders`, `remove_folder`, `index_status`.
- **Tìm và đọc:** `search_knowledge`, `read_document`, `list_documents`.
- **Wiki:** `wiki_build(folder, confirm)`, `wiki_search`, `wiki_read_page` (`index` = mục lục), `wiki_write_page`, `wiki_replace_text`.
  - `wiki_build` không có `confirm` thì chỉ trả về ước tính chi phí khi ước tính trên 1 USD.

Lưu trữ:
- Index: `%APPDATA%/airi-custom/knowledge.db`.
- Wiki: file Markdown trong `WIKI_DIR`, mỗi folder một thư mục con, link `[[slug|tên]]` (mở được bằng Obsidian).

Thiếu key thì server vẫn chạy:
- Không có `VOYAGE_API_KEY`: chỉ tìm theo từ khoá.
- Không có `ANTHROPIC_API_KEY`: không có vision, hồ sơ tài liệu và wiki.

Test: `pnpm test` trong `custom/` (`node --test`, không tốn credit, Claude và Voyage được giả lập).

## Viết docs (`mcp-docs-writer/`)

- Tool: `write_doc(title, content, sources)` và `list_docs`. Chỉ tạo file `YYYY-MM-DD-<slug>.md` mới trong `DOCS_DIR`.
- Không ghi đè: trùng tên thì thêm `-2`. Slug chỉ gồm `a-z0-9-`.

## Pose và cảm xúc VRM

Hai trang riêng trong Settings → Modules:

- **Pose**: nhập file `.vrma` (chọn nhiều file một lần), sửa tên và mô tả, phát thử, chỉnh vật lý tóc và vòng 1. Pose chỉ chạy khi bạn bảo: bấm nút pose (hình người chạy) ở ô chat, hoặc nói với Mai kiểu "vẫy tay đi".
  - Gói mocap miễn phí của VRoid (7 file `VRMA_01`…`VRMA_07`): [booth.pm/en/items/5512385](https://booth.pm/en/items/5512385). Tên và mô tả được điền sẵn theo tên file.
  - File lưu trong IndexedDB của app (`airi` / `vrm-motions`), không ra khỏi máy.
  - Tên không có trong thư viện thì AIRI thử `http://127.0.0.1:8790/motions/<tên>.vrma` (server bên dưới).
- **Cảm xúc**: tự chạy khi Mai trả lời có token ACT emotion. 11 cảm xúc dựng sẵn từ biểu cảm chuẩn của VRM (cười mỉm, cười lớn, buồn, bất ngờ, giận, ngượng, suy nghĩ, tò mò, thắc mắc, thư giãn, bình thường), mỗi cảm xúc gồm khuôn mặt và cử động đầu, vai. Có thanh độ mạnh và nút thử từng cảm xúc. `happy` với intensity từ 0,8 trở lên phát thành cười lớn.

### Server `mcp-motion/` (tuỳ chọn)

MCP server `motion` (stdio, không có dependency) vừa tạo file `.vrma` vừa phục vụ chúng qua HTTP loopback cổng `MOTION_HTTP_PORT` (mặc định 8790).

| Tool | Việc |
|---|---|
| `list_motions` | Liệt kê motion server đã tạo |
| `create_motion(name, spec)` | Mai tự soạn pose hoặc chuyển động ngắn (góc Euler theo bone), dựng `.vrma` ngay trong server |
| `generate_motion(name, prompt, duration?, engine?)` | Gọi [Text-To-VRMA](https://github.com/Kirakun0328/text-to-vrma) (`POST /v1/motions`, `format: "vrma"`) để sinh chuyển động từ mô tả |

- `create_motion` dùng `vendor/vrma-builder.mjs`, chép từ Text-To-VRMA (MIT, xem `vendor/LICENSE-text-to-vrma`).
- `generate_motion` cần Text-To-VRMA chạy riêng: clone repo, `npm install`, chép `.env.example` thành `.env`, điền `ANTHROPIC_API_KEY` (engine `claude`), rồi `npm run api` (cổng 8787). Engine `ardy` chạy model NVIDIA ARDY tại máy, không cần key nhưng cần cài đặt khoảng 20 GB.
- Biến môi trường: `MOTIONS_DIR`, `MOTION_HTTP_PORT`, `TEXT_TO_VRMA_URL`, `TEXT_TO_VRMA_ENGINE` (mặc định `claude`), `TEXT_TO_VRMA_TOKEN`.
- Tên motion chỉ gồm `a-z0-9-_`. Không ghi đè file cũ trừ khi gọi với `overwrite: true`.

Chuyển động `.vrma` phát đè lên idle với cross-fade 0,4 giây rồi tự quay về idle. Mặc định chỉ lấy track xương (biểu cảm, chớp mắt và hướng nhìn vẫn do AIRI điều khiển) và giữ hông tại chỗ.

## Cấu hình `mcp.json` của AIRI

`%APPDATA%/@proj-airi/stage-tamagotchi/mcp.json`. Key do bạn tự dán, file này nằm ngoài repo. Chạy `pnpm install --ignore-workspace` trong `custom/` một lần để cài `unpdf`, `jszip`, `@anthropic-ai/sdk`.

```json
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["D:/AIWorkStation/projects/airi/custom/knowledge/server.mjs"],
      "env": {
        "ALLOWED_ROOTS": "D:/AIWorkStation/projects;D:/AIWorkStation/docs",
        "WIKI_DIR": "D:/AIWorkStation/projects/_mai-wiki",
        "VOYAGE_API_KEY": "<voyage key>",
        "ANTHROPIC_API_KEY": "<claude key>"
      }
    },
    "docs-writer": {
      "command": "node",
      "args": ["D:/AIWorkStation/projects/airi/custom/mcp-docs-writer/server.mjs"],
      "env": { "DOCS_DIR": "D:/AIWorkStation/projects/_mai-docs" }
    },
    "motion": {
      "command": "node",
      "args": ["D:/AIWorkStation/projects/airi/custom/mcp-motion/server.mjs"],
      "env": { "MOTIONS_DIR": "D:/AIWorkStation/projects/_mai-motions" }
    }
  }
}
```

Model mặc định: `claude-haiku-5-5` cho vision, hồ sơ tài liệu và map wiki. `claude-sonnet-5-5` cho reduce và index wiki. Đổi bằng `VISION_MODEL`, `PROFILE_MODEL`, `WIKI_MAP_MODEL`, `WIKI_REDUCE_MODEL`, `EMBED_MODEL`, `EMBED_CODE_MODEL`.

## Đổi model VRM

- Toàn app: Settings → Models → chọn model, hoặc import file `.vrm` của bạn.
- Theo từng card: mở card → Edit → mục display model.
