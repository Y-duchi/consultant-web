from email.header import Header
from email.utils import formataddr

import boto3

from app.settings import Settings


def create_ses_client(settings: Settings):
  client_kwargs: dict[str, object] = {"region_name": settings.aws_region}

  if settings.aws_profile_name:
    return boto3.Session(profile_name=settings.aws_profile_name).client("sesv2", region_name=settings.aws_region)

  if settings.aws_access_key_id and settings.aws_secret_access_key and not settings.aws_use_iam_role:
    client_kwargs.update({
      "aws_access_key_id": settings.aws_access_key_id,
      "aws_secret_access_key": settings.aws_secret_access_key,
      "aws_session_token": settings.aws_session_token,
    })

  return boto3.client("sesv2", **client_kwargs)


def send_email(
  settings: Settings,
  *,
  recipient: str,
  subject: str,
  text_body: str,
  html_body: str,
) -> str:
  if not settings.email_from_address:
    raise RuntimeError("EMAIL_FROM_ADDRESS is not configured.")

  sender = formataddr((str(Header(settings.email_from_name, "utf-8")), settings.email_from_address))
  request: dict[str, object] = {
    "FromEmailAddress": sender,
    "Destination": {"ToAddresses": [recipient]},
    "Content": {
      "Simple": {
        "Subject": {"Data": subject, "Charset": "UTF-8"},
        "Body": {
          "Text": {"Data": text_body, "Charset": "UTF-8"},
          "Html": {"Data": html_body, "Charset": "UTF-8"},
        },
      },
    },
  }
  if settings.email_reply_to_address:
    request["ReplyToAddresses"] = [settings.email_reply_to_address]

  response = create_ses_client(settings).send_email(**request)
  message_id = response.get("MessageId")
  if not message_id:
    raise RuntimeError("Amazon SES did not return a MessageId.")
  return str(message_id)
