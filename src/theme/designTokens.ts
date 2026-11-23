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
  successContainer: RGB;
  onSuccess: RGB;
  onSuccessContainer: RGB;
  warning: RGB;
  warningDark: RGB;
  warningContainer: RGB;
  onWarningContainer: RGB;
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
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  dimensions: {
    buttonHeight: string;
    inputHeight: string;
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
