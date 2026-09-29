# Mermaid classes fixture

Fixture for the "keeps the classes a diagram's source names inside the diagram"
test in `mermaid.spec.ts`. Mermaid renders after the sanitizer, so the class
names this diagram's source gives its nodes reach the page, the app's own
utilities among them. None of it may reach past the diagram.

```mermaid
flowchart LR
  A[fixed]:::fixed
  B[inset]:::inset-0
  C[raised]:::z-50
  D[white]:::bg-white
  E[declared]
  A --> B --> C --> D --> E
  classDef sheet position:fixed,inset:0,z-index:50,width:9000px,height:9000px
  class E sheet
```

The end of the document.
