/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
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
