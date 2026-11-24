export type RGB = `${number} ${number} ${number}`;

export interface ThemePalette {
  primary: RGB;
  primaryPressed: RGB;
  primaryDark: RGB;
  onPrimary: RGB;
  primaryFixed: RGB;
  primaryFixedDim: RGB;
  secondary: RGB;
  secondaryContainer: RGB;
  accent: RGB;
  accentContainer: RGB;
  onAccent: RGB;
  surface: RGB;
  surfaceDim: RGB;
  surfaceContainer: RGB;
  surfaceContainerLow: RGB;
  surfaceContainerHigh: RGB;
  surfaceContainerHighest: RGB;
  surfaceContainerLowest: RGB;
  onSurface: RGB;
  onSurfaceVariant: RGB;
  outline: RGB;
  outlineVariant: RGB;
  success: RGB;
  successDark: RGB;
  successForeground: RGB;
  successContainer: RGB;
  onSuccess: RGB;
  onSuccessContainer: RGB;
  warning: RGB;
  warningDark: RGB;
  warningContainer: RGB;
  onWarningContainer: RGB;
  info: RGB;
  infoDark: RGB;
  infoContainer: RGB;
  onInfoContainer: RGB;
  error: RGB;
  errorDark: RGB;
  errorContainer: RGB;
  onErrorContainer: RGB;
}

export interface DesignTokens {
  palette: ThemePalette;
  glass: {
    surfaceAlpha: number;
    highSurfaceAlpha: number;
    blurPx: number;
    saturation: number;
  };
  radius: {
    small: string;
    medium: string;
    large: string;
    pill: string;
  };
  shadows: {
    card: string;
    sheet: string;
    overlay: string;
  };
  gradients: {
    page: string;
  };
  typography: {
    fontDisplay: string;
    fontBody: string;
    sizes: {
      headlineXl: string;
      headlineLg: string;
      headlineMd: string;
      headlineSm: string;
      titleMd: string;
      bodyLg: string;
      bodyMd: string;
      bodySm: string;
      labelLg: string;
      labelMd: string;
      labelSm: string;
      currencyDisplay: string;
    };
    lineHeights: {
      headlineXl: string;
      headlineLg: string;
      headlineMd: string;
      headlineSm: string;
      titleMd: string;
      bodyLg: string;
      bodyMd: string;
      bodySm: string;
      labelLg: string;
      labelMd: string;
      labelSm: string;
      currencyDisplay: string;
    };
    weights: {
      regular: number;
      medium: number;
      semibold: number;
      bold: number;
      extraBold: number;
    };
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
  };
  dimensions: {
    buttonHeightSmall: string;
    buttonHeightMedium: string;
    buttonHeightLarge: string;
    buttonRadius: string;
    buttonPaddingSmall: string;
    buttonPaddingMedium: string;
    buttonPaddingLarge: string;
    inputHeight: string;
    inputRadius: string;
    cardRadius: string;
    cardPadding: string;
    tableHeaderHeight: string;
    tableRowHeight: string;
    tableCellPaddingX: string;
    tableCellPaddingY: string;
    pageMaxWidth: string;
    pageGutterMobile: string;
    pageGutterTablet: string;
    pageGutterDesktop: string;
    sectionGap: string;
    cardGap: string;
    iconSmall: string;
    iconMedium: string;
  };
  animation: {
    fastMs: number;
    normalMs: number;
    slowMs: number;
  };
  zIndex: {
    navigation: number;
    popover: number;
    dialog: number;
    prompt: number;
    critical: number;
    toast: number;
  };
}
