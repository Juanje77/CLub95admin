import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "../components/RegisterSW";

export const metadata: Metadata = {
  title: "Club 95",
  description: "Gestión de caja, gastos y membresías de Club 95",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Club 95", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ff4701" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
