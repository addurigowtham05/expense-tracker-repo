import os
from PIL import Image

# Path to the uploaded source image
src_image_path = r"C:\Users\admin\.gemini\antigravity-ide\brain\21172fd6-c473-40af-9eed-c15fa2287276\media__1782581630500.png"

# Base directory of the project
project_base = r"c:\expense\frontend"

# Android mipmap configurations (folder_name, pixel_size)
android_configs = [
    ("mipmap-mdpi", 48),
    ("mipmap-hdpi", 72),
    ("mipmap-xhdpi", 96),
    ("mipmap-xxhdpi", 144),
    ("mipmap-xxxhdpi", 192)
]

def generate_icons():
    if not os.path.exists(src_image_path):
        print(f"Source image not found at {src_image_path}")
        return

    # Load source image
    img = Image.open(src_image_path)
    print(f"Loaded source image: {src_image_path} ({img.size[0]}x{img.size[1]})")

    # Generate Android icons
    res_path = os.path.join(project_base, "android", "app", "src", "main", "res")
    for folder, size in android_configs:
        folder_path = os.path.join(res_path, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # Resize image
        resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save as standard, round, and foreground launcher icons
        for icon_name in ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]:
            out_path = os.path.join(folder_path, icon_name)
            resized_img.save(out_path, "PNG")
            print(f"Generated Android icon: {out_path} ({size}x{size})")

    # Generate iOS icon (1024x1024)
    ios_icon_dir = os.path.join(project_base, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
    if os.path.exists(ios_icon_dir):
        ios_out_path = os.path.join(ios_icon_dir, "AppIcon-512@2x.png")
        resized_ios = img.resize((1024, 1024), Image.Resampling.LANCZOS)
        resized_ios.save(ios_out_path, "PNG")
        print(f"Generated iOS icon: {ios_out_path} (1024x1024)")

if __name__ == "__main__":
    generate_icons()
