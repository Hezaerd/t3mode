import { definePlugin } from "@t3mode/plugin-sdk";

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
      default: "destructive",
    },
  },
  start(api) {
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
