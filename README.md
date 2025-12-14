# FriendsGuessr

Play a geoguessr-like game with friends, using photos' EXIF metadata

## Setup

1. Add photos to `static/questions/` directory (and convert to jpg, if necessary)
    * Photos must have EXIF metadata. Share with filesharing methods like Airdrop, rather than messaging services like WhatsApp, which strip metadata from photos
1. Run app with `uv run app.py`
1. Get IP address. Invite friends on the same Wifi network to join at `{{ IP address}}:4242`
    * For example, on MacOS, use `ipconfig getifaddr en0`
1. To advance the game, type "n" or "next" into the terminal and press enter. This will start the game and show the next question (once all players have submitted their answer)
