## 2026-07-05 - Adding accessibility to icon buttons and inputs
**Learning:** Found multiple icon-only buttons and input fields without accessible names, and buttons lacking keyboard focus outlines. This is a common pattern in rapid prototyping that excludes screen reader and keyboard-only users.
**Action:** Always ensure icon-only buttons and input fields have `aria-label` attributes and interactive elements have clear `:focus-visible` outlines for keyboard navigation.
