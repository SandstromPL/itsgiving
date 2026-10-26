/** While a featured page loads: the cover's frame, so the page doesn't jump when it lands. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-8 px-4 pt-[6.5rem] pb-16 sm:px-8 sm:pt-[7rem]">
      <div aria-hidden className="surface-dark min-h-[32rem] rounded-[2rem] bg-background sm:min-h-[36rem]" />
      <p role="status" className="sr-only">
        Opening the treatment…
      </p>
    </main>
  );
}
