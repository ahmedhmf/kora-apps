export type SurveyFieldType = 'text' | 'number' | 'dropdown' | 'star' | 'radio' | 'checkbox';

export interface SurveyField {
  key: string;
  label: string;
  type: SurveyFieldType;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

export interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  fields: SurveyField[];
}

export interface GenericSubmission {
  id?: number;              // Auto-incremented primary key (IndexedDB / PostgreSQL)
  template_id: string;
  respondent_name?: string | null;   // PII: real name (null if anonymous)
  respondent_email?: string | null;  // PII: email address (null if anonymous)
  is_anonymous?: boolean;            // true = PII not stored
  client_identifier: string;         // Display name: real name or "Anonymous"
  answers: { [questionKey: string]: string };
  uuid?: string;
  status?: string;
  timestamp?: string;
}

export interface SubmissionLogEntry {
  timestamp: string;
  client: string;
  status: string;
  templateName: string;
}

