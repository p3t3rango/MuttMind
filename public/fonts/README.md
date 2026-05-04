Place the licensed Replica webfont files in this directory:

- Replica-Regular.woff2
- Replica-Mono.woff2

After adding the files, enable these declarations at the top of `src/app/globals.css`:

```css
@font-face {
  font-family: "Replica-Regular";
  src: url("/fonts/Replica-Regular.woff2") format("woff2");
  font-weight: 400 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Replica-Mono";
  src: url("/fonts/Replica-Mono.woff2") format("woff2");
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
```
