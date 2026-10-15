package billing

import (
	"strings"
)

// BillingMethod identifiers
const (
	BillingMethodStripe            = "STRIPE"
	BillingMethodAppleIAP          = "APPLE_IAP"
	BillingMethodGooglePlayBilling = "GOOGLE_PLAY_BILLING"
	BillingMethodAuraWebCheckout   = "AURA_WEB_CHECKOUT"
)

// StorefrontBillingPolicy defines the compliant billing options and external link permissions
// based on official Apple App Store and Google Play guidelines for the user's platform and region.
type StorefrontBillingPolicy struct {
	Platform                  string   `json:"platform"`
	Storefront                string   `json:"storefront"`
	SupportedBillingMethods   []string `json:"supported_billing_methods"`
	PreferredMethod           string   `json:"preferred_method"`
	ExternalCheckoutPermitted bool     `json:"external_checkout_permitted"`
	ExternalCheckoutURL       string   `json:"external_checkout_url,omitempty"`
	DisclosureNotice          string   `json:"disclosure_notice"`
	RequiresChoiceScreen      bool     `json:"requires_choice_screen"`
	ProgramEnrollmentStatus   string   `json:"program_enrollment_status"`
}

// EUStorefronts contains the 27 EU member states plus EEA where alternative billing / DMA rules apply
var EUStorefronts = map[string]bool{
	"AT": true, "BE": true, "BG": true, "HR": true, "CY": true,
	"CZ": true, "DK": true, "EE": true, "FI": true, "FR": true,
	"DE": true, "GR": true, "HU": true, "IE": true, "IT": true,
	"LV": true, "LT": true, "LU": true, "MT": true, "NL": true,
	"PL": true, "PT": true, "RO": true, "SK": true, "SI": true,
	"ES": true, "SE": true, "IS": true, "LI": true, "NO": true,
}

// GoogleUserChoiceBillingStorefronts lists regions where Google Play User Choice Billing is permitted
var GoogleUserChoiceBillingStorefronts = map[string]bool{
	"US": true, "IN": true, "KR": true, "JP": true, "BR": true,
	"AU": true, "GB": true, "CA": true,
}

// ResolveStorefrontPolicy evaluates current official store rules and returns the authoritative policy
func ResolveStorefrontPolicy(platform, storefront string, hasEntitlement bool, siteURL string) StorefrontBillingPolicy {
	normPlatform := strings.ToLower(strings.TrimSpace(platform))
	normStorefront := strings.ToUpper(strings.TrimSpace(storefront))
	if normStorefront == "" {
		normStorefront = "US"
	}
	if siteURL == "" {
		siteURL = "https://auradating.com"
	}

	switch normPlatform {
	case "web":
		return StorefrontBillingPolicy{
			Platform:                  "web",
			Storefront:                normStorefront,
			SupportedBillingMethods:   []string{BillingMethodStripe},
			PreferredMethod:           BillingMethodStripe,
			ExternalCheckoutPermitted: true,
			ExternalCheckoutURL:       siteURL + "/membership",
			DisclosureNotice:          "Secure direct checkout on the official Aura platform via Stripe.",
			RequiresChoiceScreen:      false,
			ProgramEnrollmentStatus:   "ACTIVE",
		}

	case "android":
		isEU := EUStorefronts[normStorefront]
		isUCB := GoogleUserChoiceBillingStorefronts[normStorefront] || isEU

		if isUCB {
			return StorefrontBillingPolicy{
				Platform:   "android",
				Storefront: normStorefront,
				SupportedBillingMethods: []string{
					BillingMethodGooglePlayBilling,
					BillingMethodAuraWebCheckout,
				},
				PreferredMethod:           "USER_CHOICE",
				ExternalCheckoutPermitted: true,
				ExternalCheckoutURL:       siteURL + "/membership?source=android_ucb&storefront=" + normStorefront,
				DisclosureNotice:          "Google Play User Choice Billing: Choose between Google Play Billing and Aura Direct Web Checkout. Alternative billing incurs an 11% Google Play service fee.",
				RequiresChoiceScreen:      true,
				ProgramEnrollmentStatus:   "USER_CHOICE_BILLING_ENROLLED",
			}
		}

		// Standard Google Play region
		return StorefrontBillingPolicy{
			Platform:                  "android",
			Storefront:                normStorefront,
			SupportedBillingMethods:   []string{BillingMethodGooglePlayBilling},
			PreferredMethod:           BillingMethodGooglePlayBilling,
			ExternalCheckoutPermitted: false,
			ExternalCheckoutURL:       "",
			DisclosureNotice:          "Subscriptions are processed securely through Google Play Billing in your region.",
			RequiresChoiceScreen:      false,
			ProgramEnrollmentStatus:   "STANDARD_PLAY_BILLING",
		}

	case "ios":
		isEU := EUStorefronts[normStorefront]
		isUS := normStorefront == "US"

		// Apple StoreKit External Purchase Link Entitlement
		// Aura is a dating platform, strictly excluded from the "Reader App" exemption under Guideline 3.1.3(a).
		// External links are ONLY permitted in the US or EU under official StoreKit External Purchase Link entitlements,
		// subject to Apple's 27% commission (or 12% Small Business Program) and monthly transaction reporting.
		if (isEU || isUS) && hasEntitlement {
			return StorefrontBillingPolicy{
				Platform:   "ios",
				Storefront: normStorefront,
				SupportedBillingMethods: []string{
					BillingMethodAppleIAP,
					BillingMethodAuraWebCheckout,
				},
				PreferredMethod:           BillingMethodAuraWebCheckout,
				ExternalCheckoutPermitted: true,
				ExternalCheckoutURL:       siteURL + "/membership?source=ios_link&storefront=" + normStorefront,
				DisclosureNotice:          "Apple StoreKit External Purchase Link: Aura is not a Reader App under Guideline 3.1.3(a). Purchases via external link incur Apple's 27% commission under the External Purchase Link Entitlement.",
				RequiresChoiceScreen:      true,
				ProgramEnrollmentStatus:   "STOREKIT_EXTERNAL_LINK_ENTITLED",
			}
		}

		// Rest of World (ROW) or unentitled iOS build: Apple Guideline 3.1.1 applies strictly
		return StorefrontBillingPolicy{
			Platform:                  "ios",
			Storefront:                normStorefront,
			SupportedBillingMethods:   []string{BillingMethodAppleIAP},
			PreferredMethod:           BillingMethodAppleIAP,
			ExternalCheckoutPermitted: false,
			ExternalCheckoutURL:       "",
			DisclosureNotice:          "In-app purchases are processed securely through Apple StoreKit in your region. Direct website checkout is available on auradating.com via desktop browser.",
			RequiresChoiceScreen:      false,
			ProgramEnrollmentStatus:   "STOREKIT_IAP_MANDATORY",
		}

	default:
		return StorefrontBillingPolicy{
			Platform:                  "unknown",
			Storefront:                normStorefront,
			SupportedBillingMethods:   []string{BillingMethodStripe},
			PreferredMethod:           BillingMethodStripe,
			ExternalCheckoutPermitted: true,
			ExternalCheckoutURL:       siteURL + "/membership",
			DisclosureNotice:          "Subscriptions are available at auradating.com.",
			RequiresChoiceScreen:      false,
			ProgramEnrollmentStatus:   "DEFAULT",
		}
	}
}
