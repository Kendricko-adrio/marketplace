export default function PaymentTestPage() {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <main className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Payment simulator</h1>
      <p className="mt-2 text-muted-foreground">
        The checkout reached the isolated E2E payment boundary.
      </p>
    </main>
  );
}
