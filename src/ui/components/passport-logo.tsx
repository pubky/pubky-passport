function PassportLogo() {
  return (
    <span aria-label="Pubky Passport" className="relative block h-9 w-[214px] shrink-0" role="img">
      <span className="absolute inset-[0_91.07%_18.99%_0] bg-[url('/brand/pubky-crown.svg')] bg-contain bg-no-repeat" />
      <span className="absolute inset-[21.28%_49.02%_0.05%_13.8%] bg-[url('/brand/pubky-wordmark.svg')] bg-contain bg-no-repeat" />
      <span className="absolute inset-[25.12%_0_0.01%_53.9%] bg-[url('/brand/passport-wordmark.svg')] bg-contain bg-no-repeat" />
    </span>
  );
}

export { PassportLogo };
