<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (Türkçe)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <b>Türkçe</b> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Kodlama ajanınız API ucunu 10 dakikada çıkardı. Peki istek başına 101 SQL sorgusu ve 15 MB tam tablo taraması da ekledi mi?</b><br>
  Claude Code, Codex, Cursor, Google Antigravity ve Gemini CLI için ölçüm odaklı 6 aşamalı backend performans temizleme becerisi.<br>
  Her iyileştirme <b>öncesi/sonrası kıyaslama telemetrisi</b> ve <b>birebir Golden SHA-256 eşdeğerliği</b> ile doğrulanır.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## Neleri Yakalar ve Temizler?
- **N+1 Sorgu Zincirleri (`n_plus_one_cascade`)** ve **Eksik/Bozuk İndeksler (`missing_or_broken_index`)**
- **`SELECT *` Veri Şişkinliği (`overfetch_and_payload_bloat`)** ve **Uygulama İçi Agregasyon (`in_app_aggregation`)**
- **Ardışık Asenkron Şelaleler (`async_waterfall`)**, bağlantı/işlem şişkinliği, bellek/akış tamponlama ve cold-start yükü

## 6 Aşamalı Kapalı Döngü
1. [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) ile adayları tara, [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) ile kapsamı kilitle ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. En az `1,000` yerel veri satırıyla temel metrikleri ve `golden_sha256` özetini al ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. [`HUNTING.md`](../skills/unslop-backend/HUNTING.md) ile tüm birimleri avla ve `--require-complete` kapısını geç.
4. Davranışı koruyan en küçük düzeltmeden sonra [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs) çalıştır.
5. Bağımsız doğrulayıcı sıralama, `NULL` ve kiracı izolasyonunu test eder; [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs) ile onaylar.
6. `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md` ve `NEEDS-VALIDATION.md` üretir.

## Gerçek Açık Kaynak Vaka Çalışması: `louislam/uptime-kuma` (`94.8k★`)

Gerçek `node:sqlite` üzerinde yukarı akış şeması ve sorguları (`1cc2fa7`) yeniden üretilerek `getStatusPageData` **`214 → 7 (-96.7%)`** ve `getRSSPageData` **`314 → 8 (-97.5%)`** sorguya düşürüldü ve birebir **Golden SHA-256 eşleşmesi** doğrulandı ([rapor](../examples/case-studies/uptime-kuma/README.md)).

## Kurulum ve Test

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

Ayrıntılar için [İngilizce README](../README.md) ve [Doğrulama Durumu](../docs/STATUS.md) ([MIT Lisansı](../LICENSE)) dosyalarına bakın.
