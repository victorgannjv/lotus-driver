/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // One typeface everywhere. Before this the app inherited Tailwind's
      // system stack, so the same screen was Segoe UI on the ops laptop, SF on
      // a manager's Mac and Roboto on the driver's handset -- three different
      // looks for one app, and column widths that shifted between them. Inter
      // ships with the bundle (see index.css), so it renders the same offline
      // and on a locked-down network.
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "-apple-system",
               '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      // Pulled from ninjavan.co's own tracking page: header bg rgb(35,31,32),
      // primary CTA rgb(194,0,47).
      colors: {
        brand: {
          red: "#C2002F",
          "red-dark": "#96001F",
          black: "#231F20",
        },
      },
    },
  },
  plugins: [],
};
