import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16202B",
        muted: "#5B6B7C",
        paper: "#F4F6F8",
        line: "#DDE3E9",
      },
    },
  },
  plugins: [],
};
export default config;
