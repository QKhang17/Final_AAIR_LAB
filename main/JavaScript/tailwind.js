tailwind.config = {
    darkMode: "class",

    theme: {
        extend: {

            /* =========================================================
               COLORS
               ========================================================= */

            colors: {

                /* Main  Color */
                "normal": "#0A3D91",
                "button-hover": "rgba(255, 255, 255, 0.1)",
                "button-active": "rgba(255, 255, 255, 0.18)",
                "text-hover": "#D1D5DB",
                "text-active": "#F1F5F9",

                /* Primary */
                "primary": "#004ac6",
                "primary-container": "#2563eb",
                "primary-fixed": "#dbe1ff",
                "primary-fixed-dim": "#b4c5ff",

                "on-primary": "#ffffff",
                "on-primary-container": "#eeefff",
                "on-primary-fixed": "#00174b",
                "on-primary-fixed-variant": "#003ea8",

                /* Secondary */
                "secondary": "#00687a",
                "secondary-container": "#57dffe",
                "secondary-fixed": "#acedff",
                "secondary-fixed-dim": "#4cd7f6",

                "on-secondary": "#ffffff",
                "on-secondary-container": "#006172",
                "on-secondary-fixed": "#001f26",
                "on-secondary-fixed-variant": "#004e5c",

                /* Tertiary */
                "tertiary": "#006242",
                "tertiary-container": "#007d55",
                "tertiary-fixed": "#6ffbbe",
                "tertiary-fixed-dim": "#4edea3",

                "on-tertiary": "#ffffff",
                "on-tertiary-container": "#bdffdb",
                "on-tertiary-fixed": "#002113",
                "on-tertiary-fixed-variant": "#005236",

                /* =====================================================
                   SURFACE
                   Main = Tailwind 2
                   Legacy = Tailwind 1
                   ===================================================== */

                "surface": "#f7f9fb",
                "surface-legacy": "#f8f9ff",

                "surface-bright": "#f7f9fb",
                "surface-bright-legacy": "#f8f9ff",

                "surface-dim": "#d8dadc",
                "surface-dim-legacy": "#cbdbf5",

                "surface-variant": "#e0e3e5",
                "surface-variant-legacy": "#d3e4fe",

                "surface-container-lowest": "#ffffff",

                "surface-container-low": "#f2f4f6",
                "surface-container-low-legacy": "#eff4ff",

                "surface-container": "#eceef0",
                "surface-container-legacy": "#e5eeff",

                "surface-container-high": "#e6e8ea",
                "surface-container-high-legacy": "#dce9ff",

                "surface-container-highest": "#e0e3e5",
                "surface-container-highest-legacy": "#d3e4fe",

                /* Text */
                "on-surface": "#191c1e",
                "on-surface-variant": "#434655",

                /* Background */
                "background": "#f7f9fb",
                "background-legacy": "#f8f9ff",

                "on-background": "#191c1e",
                "on-background-legacy": "#0b1c30",

                /* Outline */
                "outline": "#737686",
                "outline-variant": "#c3c6d7",

                /* Inverse */
                "inverse-surface": "#2d3133",
                "inverse-on-surface": "#eff1f3",
                "inverse-primary": "#b4c5ff",

                /* Tint */
                "surface-tint": "#0053db",

                /* Error */
                "error": "#ba1a1a",
                "error-container": "#ffdad6",
                "on-error": "#ffffff",
                "on-error-container": "#93000a"
            },


            /* =========================================================
               BORDER RADIUS
               Both versions match
               ========================================================= */

            borderRadius: {
                "DEFAULT": "0.25rem",
                "lg": "0.5rem",
                "xl": "0.75rem",
                "full": "9999px"
            },


            /* =========================================================
               SPACING
               Combined V1 + V2
               ========================================================= */

            spacing: {

                /* Tailwind 1 tokens */
                "base": "8px",
                "gutter": "24px",

                "margin-sm": "8px",
                "margin-md": "16px",
                "margin-lg": "32px",
                "container-padding": "24px",

                /* Tailwind 2 tokens */
                "xs": "4px",
                "sm": "8px",
                "md": "16px",
                "lg": "24px",
                "xl": "32px",
                "2xl": "48px",
                "3xl": "64px",

                "container-max": "1280px",

                /* Tailwind 1 original conflicting values */
                "base-legacy": "4px",
                "gutter-legacy": "16px"
            },


            /* =========================================================
               FONT FAMILY
               Combined V1 + V2
               ========================================================= */

            fontFamily: {

                /* Standard default font mappings */
                "sans": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "mono": ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],

                /* Body */
                "body-sm": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "body-md": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "body-lg": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],

                /* Headlines */
                "headline-sm": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "headline-md": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "headline-lg": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "headline-lg-mobile": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],

                /* Display */
                "display-lg": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
                "display-lg-mobile": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],

                /* Labels */
                "label-md": ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],

                /* Code */
                "code": ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
                "code-sm": ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"]
            },


            /* =========================================================
               FONT SIZE
               Combined V1 + V2
               ========================================================= */

            fontSize: {

                /* -------------------------
                   Display
                   ------------------------- */

                "display-lg": [
                    "48px",
                    {
                        lineHeight: "56px",
                        letterSpacing: "-0.02em",
                        fontWeight: "700"
                    }
                ],

                "display-lg-mobile": [
                    "28px",
                    {
                        lineHeight: "36px",
                        letterSpacing: "-0.02em",
                        fontWeight: "700"
                    }
                ],


                /* -------------------------
                   Headlines
                   ------------------------- */

                "headline-lg": [
                    "32px",
                    {
                        lineHeight: "40px",
                        letterSpacing: "-0.01em",
                        fontWeight: "600"
                    }
                ],

                "headline-md": [
                    "24px",
                    {
                        lineHeight: "32px",
                        fontWeight: "600"
                    }
                ],

                "headline-lg-mobile": [
                    "24px",
                    {
                        lineHeight: "32px",
                        letterSpacing: "-0.01em",
                        fontWeight: "600"
                    }
                ],

                "headline-sm": [
                    "20px",
                    {
                        lineHeight: "28px",
                        fontWeight: "600"
                    }
                ],


                /* -------------------------
                   Body
                   ------------------------- */

                "body-lg": [
                    "18px",
                    {
                        lineHeight: "28px",
                        fontWeight: "400"
                    }
                ],

                "body-md": [
                    "16px",
                    {
                        lineHeight: "24px",
                        fontWeight: "400"
                    }
                ],

                "body-sm": [
                    "14px",
                    {
                        lineHeight: "20px",
                        fontWeight: "400"
                    }
                ],


                /* -------------------------
                   Labels
                   ------------------------- */

                "label-md": [
                    "14px",
                    {
                        lineHeight: "20px",
                        fontWeight: "500"
                    }
                ],


                /* -------------------------
                   Code
                   ------------------------- */

                "code": [
                    "13px",
                    {
                        lineHeight: "20px",
                        fontWeight: "400"
                    }
                ],

                "code-sm": [
                    "13px",
                    {
                        lineHeight: "20px",
                        fontWeight: "400"
                    }
                ]
            }
        }
    }
};