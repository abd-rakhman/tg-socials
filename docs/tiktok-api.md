# TikTok API (direct)

Two requests: get the video info, then download the video file.

---

## 1. Get video info

```
GET https://www.tiktok.com/@{user}/video/{id}
```

Short links (`https://vt.tiktok.com/{code}/`) work too. They redirect (`302`) to the full link.

### Request headers

| Header | Value | Required |
|---|---|---|
| `User-Agent` | any browser user agent | yes |

### Response

`200`, HTML page.

**Cookies** (`Set-Cookie`):

| Cookie | Use |
|---|---|
| `tt_chain_token` | needed for request 2 |

**Data**: JSON inside this tag:

```
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{...}</script>
```

JSON shape (only the useful fields):

```json
{
  "__DEFAULT_SCOPE__": {
    "webapp.video-detail": {
      "statusCode": 0,
      "itemInfo": {
        "itemStruct": {
          "id": "7633141929030503698",
          "desc": "video caption",
          "video": {
            "duration": 54,
            "bitrateInfo": [
              {
                "GearName": "adapt_540_1",
                "CodecType": "h265_hvc1",
                "Bitrate": 711166,
                "PlayAddr": {
                  "DataSize": "4805262",
                  "Width": 576,
                  "Height": 1024,
                  "UrlList": ["https://...", "https://...", "https://..."]
                }
              }
            ]
          },
          "imagePost": {
            "images": [
              { "imageURL": { "urlList": ["https://..."] } }
            ]
          }
        }
      }
    }
  }
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `statusCode` | number | `0` = OK. Other = video deleted, private or blocked. |
| `video.duration` | number | Length in seconds. |
| `video.bitrateInfo` | array | Available video versions. Count differs per video. |
| `bitrateInfo[].CodecType` | string | `h264` or `h265_hvc1`. |
| `bitrateInfo[].PlayAddr.DataSize` | **string** | File size in bytes. Convert to number before comparing. |
| `bitrateInfo[].PlayAddr.UrlList` | string[] | Download links for this version. Use the first. Expire in ~48 h. |
| `imagePost.images[].imageURL.urlList` | string[] | Photo post images. Only on photo posts. *Not tested.* |

To get the smallest video, pick the `bitrateInfo` entry with the smallest `DataSize`.

---

## 2. Download video

```
GET {UrlList[0]}
```

### Request headers

| Header | Value | Required |
|---|---|---|
| `Cookie` | `tt_chain_token={value from request 1}` | yes |
| `Referer` | `https://www.tiktok.com/` | yes |

### Response

| Status | Meaning |
|---|---|
| `200` | Body is the `.mp4` file. |
| `403` | Missing `Cookie` or `Referer`. |

---

## Telegram notes

- Telegram can't fetch these links itself (they need the cookie). Download, then upload as a buffer.
- Bot upload limit: 50 MB.
