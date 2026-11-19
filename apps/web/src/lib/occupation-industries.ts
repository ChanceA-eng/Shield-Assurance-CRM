import occupations from './data/occupations.json';

export const OCCUPATION_INDUSTRIES = [
  { code: '11', label: 'Management' },
  { code: '13', label: 'Business & finance' },
  { code: '15', label: 'Technology & mathematics' },
  { code: '17', label: 'Architecture & engineering' },
  { code: '19', label: 'Science & research' },
  { code: '21', label: 'Community & social services' },
  { code: '23', label: 'Legal services' },
  { code: '25', label: 'Education & libraries' },
  { code: '27', label: 'Arts, entertainment, sports & media' },
  { code: '29', label: 'Healthcare practitioners & technicians' },
  { code: '31', label: 'Healthcare support' },
  { code: '33', label: 'Protective services' },
  { code: '35', label: 'Food service & hospitality' },
  { code: '37', label: 'Building & grounds maintenance' },
  { code: '39', label: 'Personal care & services' },
  { code: '41', label: 'Sales & retail' },
  { code: '43', label: 'Office & administrative support' },
  { code: '45', label: 'Agriculture, fishing & forestry' },
  { code: '47', label: 'Construction & extraction' },
  { code: '49', label: 'Installation, maintenance & repair' },
  { code: '51', label: 'Manufacturing & production' },
  { code: '53', label: 'Transportation & material moving' },
  { code: '55', label: 'Military' },
  { code: 'other', label: 'Other' },
].sort((a, b) => a.label.localeCompare(b.label));

export function occupationIndustry(code: string): string {
  return occupations.some((row) => row.code === code) ? code.slice(0, 2) : '';
}

export function occupationsForIndustry(industry: string): typeof occupations {
  return occupations.filter((row) => row.code.startsWith(`${industry}-`)).sort((a, b) => a.title.localeCompare(b.title));
}
