import "./globals.css";

export const metadata = {
  title: "SAT Practice Test",
  description: "A timed, replayable SAT-style practice test with instant scoring and explanations.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
