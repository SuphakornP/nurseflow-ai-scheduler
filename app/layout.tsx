import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "NurseFlow AI | Clinical Schedule Workspace",
  description:
    "A privacy-aware nurse scheduling showcase that turns requests into validated, explainable candidate rosters.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
