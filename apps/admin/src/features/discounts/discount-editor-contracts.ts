import type { DiscountDraftConfiguration } from "@marketplace/db/src/discount-draft";
import type { DiscountOfferDetailDto } from "@/lib/discounts-administration";

export interface DiscountEditorVersions {
  version: number;
  draftVersion: number;
  policyVersion: number;
}

export interface DiscountEditorDetail extends DiscountOfferDetailDto {
  draftConfiguration: DiscountDraftConfiguration;
  configurationSource: "draft" | "live" | "empty";
}

export interface DiscountConfigurationChangeSet {
  path: string;
  before: unknown;
  after: unknown;
}

export interface DiscountReview {
  offerId: string;
  offerVersion: number;
  draftVersion: number;
  policyVersion: number;
  fingerprint: string;
  stateAfter: string;
  configuration: DiscountDraftConfiguration;
  changes: DiscountConfigurationChangeSet[];
  issues: import("@marketplace/db/src/discount-draft").DiscountDraftIssue[];
  warnings: string[];
}

export interface PublishDiscountConfigurationInput {
  offerId: string;
  requestKey: string;
  expectedOfferVersion: number;
  expectedDraftVersion: number;
  expectedPolicyVersion: number;
  reviewFingerprint: string;
}

export interface PublishDiscountConfigurationResult {
  data: DiscountEditorDetail;
  replayed: boolean;
}

export interface SaveDiscountConfigurationInput {
  offerId: string;
  requestKey: string;
  expectedOfferVersion: number;
  expectedDraftVersion: number;
  configuration: DiscountDraftConfiguration;
}
