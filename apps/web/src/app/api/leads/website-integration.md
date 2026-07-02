# Website Leads Integration

Use this endpoint from your public website form to push every submission into CRM leads.

## Endpoint

- Production: `https://<your-crm-web-domain>/api/leads`
- Method: `POST`
- Accepted encodings: `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data`

## Required field

- `full_name` (or `fullName`, `name`, `first_name` + `last_name`)

## Recommended fields to send

- Contact: `phone`, `email`, `zip`, `state`
- Lead intent: `line`, `line_of_business`, `primaryCoverage`, `business`
- Quote details: `vin`, `year`, `make`, `model`, `requirements`, `message`
- Attribution: `source`, `src`, `from`, `utm_source`

All submitted fields are preserved in `form_payload` and request metadata is captured in `form_payload._request`.

## HTML form example

```html
<form action="https://<your-crm-web-domain>/api/leads" method="post">
  <input type="text" name="full_name" placeholder="Full name" required>
  <input type="email" name="email" placeholder="Email">
  <input type="tel" name="phone" placeholder="Phone">
  <input type="text" name="zip" placeholder="ZIP">
  <input type="text" name="line" value="auto">
  <input type="text" name="source" value="website-contact-form">
  <textarea name="requirements" placeholder="Coverage requirements"></textarea>
  <button type="submit">Submit</button>
</form>
```

## JavaScript fetch example

```html
<script>
  async function submitLead(formEl) {
    const formData = new FormData(formEl);

    const res = await fetch('https://<your-crm-web-domain>/api/leads', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.message || 'Lead submission failed');
    }

    return res.json();
  }
</script>
```

## CORS allow list

The API already allows:

- `https://www.shield-assurance.com`
- `https://shield-assurance.com`

Add more origins via `LEADS_ALLOWED_ORIGINS` as a comma-separated list.
