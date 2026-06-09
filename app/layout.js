import "./globals.css";

export const metadata = {
  title: "Stack Detective",
  description: "Detect search, discovery & personalization vendors on any site.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
