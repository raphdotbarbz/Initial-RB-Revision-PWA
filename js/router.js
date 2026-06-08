function parseQuery(search = "") {
  const params = new URLSearchParams(search);
  return Object.fromEntries(params.entries());
}

function cleanHash(hash) {
  return (hash || "#/home").replace(/^#/, "") || "/home";
}

export function parseRoute(hash = window.location.hash) {
  const cleaned = cleanHash(hash);
  const [path, queryString = ""] = cleaned.split("?");
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { view: "home", module: null, query: {} };
  }

  if (segments[0] === "settings") {
    return { view: "settings", module: null, query: parseQuery(queryString) };
  }

  if (segments[0] === "quiz") {
    return { view: "quiz", module: segments[1] || "pe", query: parseQuery(queryString) };
  }

  if (segments[0] === "flashcards") {
    return { view: "flashcards", module: segments[1] || "caia", query: parseQuery(queryString) };
  }

  if (segments[0] === "module") {
    return { view: "module", module: segments[1] || "pe", query: parseQuery(queryString) };
  }

  return { view: "home", module: null, query: parseQuery(queryString) };
}

export function buildHash(view, module = "", query = {}) {
  const base =
    view === "settings"
      ? "/settings"
      : view === "quiz"
        ? `/quiz/${module}`
        : view === "flashcards"
          ? `/flashcards/${module}`
        : view === "module"
          ? `/module/${module}`
          : "/home";

  const search = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "")
  ).toString();

  return search ? `#${base}?${search}` : `#${base}`;
}

export function navigate(view, module = "", query = {}) {
  window.location.hash = buildHash(view, module, query);
}

export function startRouter(onChange) {
  const emit = () => onChange(parseRoute(window.location.hash));
  window.addEventListener("hashchange", emit);
  emit();
}
