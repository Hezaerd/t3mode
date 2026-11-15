import { definePlugin } from "@t3mode/plugin-sdk";

// Newest markup first. Prefer the data-* hooks T3 Code documents over class names.
const COMPOSER = ["[data-chat-composer-form]"];

export default definePlugin({
  options: {
    color: {
      type: "select",
      label: "Outline color",
      description: "The color of the outline around the message box.",
      choices: [
        { value: "primary", label: "Theme color" },
        { value: "destructive", label: "Red" },
      ],
      default: "primary",
    },
  },
  start(api) {
    // CSS styles React's nodes without touching them.
    api.css(
      `${COMPOSER.join(", ")} { outline: 2px solid var(--${api.options.color}); outline-offset: 2px; }`,
    );
    api.observe(() => {
      api.report(
        api.queryFirst(COMPOSER)
          ? { state: "active", detail: "Outlining the message box" }
          : { state: "waiting", detail: "Open a thread to see the outline" },
      );
    });
  },
});
