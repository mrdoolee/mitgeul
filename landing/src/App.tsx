import { Hero } from "@/components/ui/hero-with-group-of-images-text-and-two-buttons";
import {
  AreasSection,
  DownloadSection,
  FlowSection,
  PrivacySection,
  SiteFooter,
  SiteHeader,
} from "@/components/landing/sections";

export default function App() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2">
        본문으로 건너뛰기
      </a>
      <SiteHeader />
      <main id="main">
        <div id="top" className="bg-[linear-gradient(180deg,#e8eef5_0%,var(--canvas)_70%)]">
          <Hero />
        </div>
        <FlowSection />
        <AreasSection />
        <PrivacySection />
        <DownloadSection />
      </main>
      <SiteFooter />
    </>
  );
}
