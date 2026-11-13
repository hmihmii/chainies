#!/bin/sh
# Gộp mọi thứ thành một trang duy nhất (dùng để xuất bản dạng một tệp).
out="${1:-dist.html}"
{
  echo '<title>Chainies HSK4</title><meta name="claude:viewport-fit-sides" content="cover">'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600&family=Lexend:wght@400;500&display=swap">'
  echo '<style>'; cat styles.css; echo '</style><div id="app"></div>'
  echo '<script src="https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js"></script>'
  echo '<script>'; cat data.js strokes.js; echo '</script><script>'; cat app.js; echo '</script>'
} > "$out"
