# Paperlogy (페이퍼로지) font files

The app's font. Defined in `paperlogy.ts` (this folder) with `next/font/local`
and applied in `src/app/layout.tsx`, so it is served from our own domain (no
external font service at runtime). `globals.css` makes it the default font.

| File                       | Weight     | Used for                               |
| -------------------------- | ---------- | -------------------------------------- |
| `Paperlogy-4Regular.woff2` | 400        | body text, inputs, table cells         |
| `Paperlogy-7Bold.woff2`    | 700 (bold) | titles, labels, buttons, table headers |

## License: SIL Open Font License 1.1 (OFL)

- Font page: https://freesentation.blog/paperlogyfont — "상업용으로 사용 가능한
  무료 폰트 … SIL 오픈폰트라이선스(OFL)에 따라 글꼴 단독 판매 또는 글꼴
  라이선스 변경을 제외한 모든 상업적 행위 및 수정, 재배포가 가능합니다."
- Full license text: `OFL.txt` (the copy linked from the font page).
- Allowed: use in this company's web app (commercial use) and embedding the
  font files in the website. Not allowed: selling the font files on their own.
  Keep `OFL.txt` next to the files.
- Authors: 이주임 (Freesentation) and 김도균 (Paperlogy). Hangul based on
  G마켓산스, Latin based on Montserrat.

## Where the files came from (2026-10-21)

- The font page only offers TTF zips:
  https://github.com/Freesentation/paperlogy/raw/refs/heads/main/Paperlogy-1.000.zip
- The `.woff2` files are the web versions of those TTFs from the
  눈누 (noonnu) mirror: `https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/`.
- Checked against the official v1.000 TTFs: same 11,723 characters (all
  11,172 Hangul syllables), same name/version/license strings, embedding
  allowed (OS/2 fsType 0).
