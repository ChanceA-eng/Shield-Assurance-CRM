export const personalEngine = {
  personal_modules: {
    auto_line: {
      trigger_flag: 'quote_auto',
      required_fields: ['driver_count', 'vehicle_count', 'prior_liability_limits'],
      label: 'Personal Automobile',
    },
    property_line: {
      trigger_flag: 'quote_home',
      required_fields: ['year_built', 'roof_material', 'has_pool', 'dog_breed'],
      label: 'Homeowners Insurance',
    },
    umbrella_line: {
      trigger_flag: 'quote_umbrella',
      required_fields: ['required_underlying_limits'],
      label: 'Personal Excess Liability',
    },
  },
  underwriting_flags: {
    high_risk_dog_breeds: ['Pit Bull', 'Rottweiler', 'Doberman'],
    minimum_auto_limits_for_umbrella: '250/500/250',
  },
} as const;

export type PersonalModuleKey = keyof typeof personalEngine.personal_modules;
