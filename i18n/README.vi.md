<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (Tiếng Việt)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <b>Tiếng Việt</b> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Agent của bạn code xong API trong 10 phút. Nó có vô tình nhét thêm 101 câu truy vấn SQL và quét toàn bảng 15 MB mỗi request không?</b><br>
  Skill 6 pha lấy đo đạc làm chuẩn cho Claude Code, Codex, Cursor, Google Antigravity và Gemini CLI.<br>
  Mọi bản sửa lỗi đều phải vượt qua cổng <b>đo kiểm trước/sau ghép cặp</b> và <b>khớp chính xác mã băm Golden SHA-256</b>.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## 8 nhóm slop backend được xử lý
- **Chuỗi truy vấn N+1 (`n_plus_one_cascade`)** và **thiếu/hỏng chỉ mục (`missing_or_broken_index`)**
- **Dư thừa `SELECT *` (`overfetch_and_payload_bloat`)** và **tính tổng/lọc trong RAM ứng dụng (`in_app_aggregation`)**
- **Thác nước bất đồng bộ tuần tự (`async_waterfall`)**, phình kết nối/transaction, đệm luồng RAM và cold start

## Quy trình khép kín 6 pha
1. Quét ứng viên bằng [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) và kiểm tra sổ cái qua [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. Tạo dữ liệu cục bộ (`>= 1,000` dòng) để ghi nhận baseline và `golden_sha256` ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. Săn slop theo từng đơn vị ([`HUNTING.md`](../skills/unslop-backend/HUNTING.md)) và kiểm tra `--require-complete`.
4. Sửa tối thiểu không đổi contract và kiểm định bằng [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs).
5. Kiểm tra phản biện độc lập + [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs).
6. Xuất `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md` và `NEEDS-VALIDATION.md`.

## Case study mã nguồn mở thực tế: `louislam/uptime-kuma` (`94.8k★`)

Tái hiện trực tiếp trên `node:sqlite` với schema và SQL gốc (`1cc2fa7`): giảm `getStatusPageData` từ **`214 → 7` truy vấn (`-96.7%`)** và `getRSSPageData` từ **`314 → 8` (`-97.5%`)**, đảm bảo **khớp hoàn toàn Golden SHA-256** ([chi tiết](../examples/case-studies/uptime-kuma/README.md)).

## Cài đặt & chạy thử

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

Xem thêm [README tiếng Anh](../README.md) và [trạng thái kiểm chứng](../docs/STATUS.md) ([Giấy phép MIT](../LICENSE)).
