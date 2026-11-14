import { BrandLogo } from "@/components/layout/brand-logo";

/** Sign-in screens: white card on the brand page background, logo on white (brand rule). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div
        aria-hidden="true"
        className="h-1.5 w-full bg-[url('/brand/pattern/so-triangle-pattern.jpg')] bg-cover bg-center"
      />
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-lg border bg-white p-6 sm:p-8">
          <div className="mb-6 flex justify-center">
            <BrandLogo variant="primary" height={56} priority />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
