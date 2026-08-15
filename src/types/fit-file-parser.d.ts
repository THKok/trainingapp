declare module "fit-file-parser" {
  interface FitParserOptions {
    force?: boolean;
    speedUnit?: string;
    lengthUnit?: string;
    temperatureUnit?: string;
    elapsedRecordField?: boolean;
    mode?: string;
  }
  export default class FitParser {
    constructor(options?: FitParserOptions);
    parse(
      content: Buffer | ArrayBuffer,
      callback: (error: string | null, data: any) => void
    ): void;
  }
}
