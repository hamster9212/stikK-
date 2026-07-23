import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "박준영의 책임 원장",
  description: "푸시업·윗몸일으키기·주식 계획의 증빙과 실패를 숨김없이 기록하는 책임 원장",
  manifest: "/stikK-/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
