#---
name: agents
description: "Workspace instructions — always apply"
applyTo: "**"
-------------

# UI

- mobile view means below 768px
- use mobile first breakpoints, do not add more breakpoints, use only the existing breakpoints: 480, 768, 1024, 1600px
- if you find different breakpoints convert it to the allowed values
- do not add inline styles
- use only the predefined variable colors, or ask
- every new ui element should use the style of existing similar elements style, ask if not clear
- new buttons add to buttons.css
- below 1024px use the mini logo (logo-mini.svg, wave mark only) for the brand logo, same height as the full logo

# code

- always use english in code

# compatibility

- target: Safari 12+ / iOS 12+ (no transpilation, no polyfills)
- do NOT use: class fields (`x = y` in class body), optional chaining (`?.`), CSS `:has()`, CSS `clamp()`
- ok to use: `class`, `import/export`, arrow functions, `const/let`, `async/await`, template literals, destructuring, spread, `Set`/`Map`, CSS Grid, CSS variables, `fetch()`

"The terminal is awaiting input" is just an exit option, you can ignore it and proceed

let me know when you've read the file
