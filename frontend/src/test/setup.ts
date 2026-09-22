import "@testing-library/jest-dom";

// jsdom does no layout, so Element.scrollIntoView does not exist at all — a
// component that keeps its selection visible (both pickers, the contents panel)
// throws "not a function" the moment a test renders it with rows. In a browser
// it is real; in a test it has nothing to do.
Element.prototype.scrollIntoView = () => {};
