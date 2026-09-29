export interface PassportInstance {
  origin: string;
  host: string;
  source: "default" | "user";
  isCustom: boolean;
}
