export type DayHours = { open: string; close: string } | null;

export interface OperatingHours {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  operatingHours: OperatingHours;
  googleMapsUrl: string | null;
  status: string;
}