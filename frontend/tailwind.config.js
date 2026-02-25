export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: '#0b101c',
                panel: '#141b2d',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
